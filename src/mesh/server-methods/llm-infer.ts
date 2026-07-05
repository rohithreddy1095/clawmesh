import type { WebSocket } from "ws";
import type {
  LlmChunkEvent,
  LlmInferRequest,
  LlmProviderFinal,
  LlmProviderChunk,
  MeshLlmProvider,
} from "../llm-types.js";

export type { MeshLlmProvider } from "../llm-types.js";

type HandlerFn = (opts: {
  req: Record<string, unknown>;
  params: Record<string, unknown>;
  respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void;
}) => void | Promise<void>;

type Handlers = Record<"llm.infer" | "llm.cancel", HandlerFn>;

const WS_OPEN = 1;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BUFFERED_AMOUNT = 1024 * 1024;
const MAX_CHUNK_BYTES = 8 * 1024;

type ActiveInference = {
  requestId: string;
  controller: AbortController;
};

export function createLlmInferenceHandlers(opts: {
  provider: MeshLlmProvider;
  timeoutMs?: number;
  maxBufferedAmount?: number;
}): Handlers {
  let active: ActiveInference | null = null;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBufferedAmount = opts.maxBufferedAmount ?? DEFAULT_MAX_BUFFERED_AMOUNT;

  return {
    "llm.infer": async ({ req, params, respond }) => {
      const parsed = parseInferRequest(params);
      if (!parsed.ok) {
        respond(false, undefined, {
          code: "INVALID_PARAMS",
          message: parsed.message,
        });
        return;
      }

      const request = parsed.request;
      if (!opts.provider.canServe(request.model)) {
        respond(false, undefined, {
          code: "LLM_MODEL_UNAVAILABLE",
          message: `model is not served by this node: ${request.model}`,
        });
        return;
      }

      if (active) {
        respond(false, undefined, {
          code: "LLM_BUSY",
          message: `already serving inference request ${active.requestId}`,
        });
        return;
      }

      const socket = req._socket as WebSocket | undefined;
      const controller = new AbortController();
      active = { requestId: request.requestId, controller };
      const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);

      try {
        let seq = 0;
        const iterator = opts.provider.infer(request, { signal: controller.signal });
        let final: LlmProviderFinal | void;

        while (true) {
          const next = await iterator.next();
          if (next.done) {
            final = next.value;
            break;
          }

          for (const delta of splitDelta(next.value)) {
            if (controller.signal.aborted) {
              break;
            }
            if (socket && socket.bufferedAmount > maxBufferedAmount) {
              controller.abort("backpressure");
              await iterator.return?.({ finishReason: "cancelled" });
              respond(false, undefined, {
                code: "LLM_BACKPRESSURE",
                message: "socket bufferedAmount exceeded llm stream limit",
              });
              return;
            }
            sendChunk(socket, { requestId: request.requestId, seq, delta });
            seq++;
          }
        }

        if (controller.signal.aborted) {
          const reason = controller.signal.reason;
          if (reason === "timeout") {
            respond(false, undefined, {
              code: "LLM_TIMEOUT",
              message: `llm inference timed out after ${timeoutMs}ms`,
            });
            return;
          }
          if (reason === "backpressure") {
            respond(false, undefined, {
              code: "LLM_BACKPRESSURE",
              message: "socket bufferedAmount exceeded llm stream limit",
            });
            return;
          }
        }

        respond(true, {
          requestId: request.requestId,
          finishReason: final?.finishReason ?? (controller.signal.aborted ? "cancelled" : "stop"),
          usage: final?.usage,
        });
      } catch (err) {
        if (controller.signal.aborted && controller.signal.reason === "timeout") {
          respond(false, undefined, {
            code: "LLM_TIMEOUT",
            message: `llm inference timed out after ${timeoutMs}ms`,
          });
          return;
        }
        respond(false, undefined, {
          code: controller.signal.aborted ? "LLM_CANCELLED" : "LLM_MODEL_UNAVAILABLE",
          message: String(err),
        });
      } finally {
        clearTimeout(timer);
        if (active?.requestId === request.requestId) {
          active = null;
        }
      }
    },

    "llm.cancel": ({ params, respond }) => {
      const requestId = typeof params.requestId === "string" ? params.requestId : "";
      if (!requestId) {
        respond(false, undefined, {
          code: "INVALID_PARAMS",
          message: "llm.cancel requires requestId",
        });
        return;
      }
      if (!active || active.requestId !== requestId) {
        respond(false, undefined, {
          code: "LLM_CANCELLED",
          message: `no active llm request ${requestId}`,
        });
        return;
      }
      active.controller.abort("cancelled");
      respond(true, { requestId, cancelled: true });
    },
  };
}

function parseInferRequest(params: Record<string, unknown>):
  | { ok: true; request: LlmInferRequest }
  | { ok: false; message: string } {
  const requestId = params.requestId;
  const model = params.model;
  const messages = params.messages;
  if (typeof requestId !== "string" || !requestId) {
    return { ok: false, message: "llm.infer requires requestId" };
  }
  if (typeof model !== "string" || !model) {
    return { ok: false, message: "llm.infer requires model" };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, message: "llm.infer requires non-empty messages[]" };
  }

  const parsedMessages = messages.map((message) => {
    if (!message || typeof message !== "object") {
      return null;
    }
    const record = message as Record<string, unknown>;
    if (
      record.role !== "system" &&
      record.role !== "user" &&
      record.role !== "assistant"
    ) {
      return null;
    }
    if (typeof record.content !== "string") {
      return null;
    }
    return {
      role: record.role,
      content: record.content,
    };
  });
  if (parsedMessages.some((message) => !message)) {
    return { ok: false, message: "messages must have role and string content" };
  }

  const maxTokens = typeof params.maxTokens === "number" && Number.isFinite(params.maxTokens)
    ? Math.max(1, Math.floor(params.maxTokens))
    : undefined;
  const temperature = typeof params.temperature === "number" && Number.isFinite(params.temperature)
    ? params.temperature
    : undefined;

  return {
    ok: true,
    request: {
      requestId,
      model,
      messages: parsedMessages as LlmInferRequest["messages"],
      maxTokens,
      temperature,
    },
  };
}

function sendChunk(socket: WebSocket | undefined, chunk: LlmChunkEvent): void {
  if (!socket || socket.readyState !== WS_OPEN) {
    return;
  }
  socket.send(JSON.stringify({
    type: "event",
    event: "llm.chunk",
    payload: chunk,
  }));
}

function splitDelta(chunk: LlmProviderChunk): string[] {
  const delta = chunk.delta;
  if (!delta) {
    return [];
  }
  if (Buffer.byteLength(delta, "utf8") <= MAX_CHUNK_BYTES) {
    return [delta];
  }

  const pieces: string[] = [];
  let current = "";
  for (const char of delta) {
    if (Buffer.byteLength(current + char, "utf8") > MAX_CHUNK_BYTES) {
      pieces.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) {
    pieces.push(current);
  }
  return pieces;
}

