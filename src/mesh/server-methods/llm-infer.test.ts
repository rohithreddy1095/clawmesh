import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createLlmInferenceHandlers, type MeshLlmProvider } from "./llm-infer.js";
import type { LlmInferRequest } from "../llm-types.js";

type Handlers = ReturnType<typeof createLlmInferenceHandlers>;

function makeSocket(bufferedAmount = 0) {
  return {
    readyState: WebSocket.OPEN,
    bufferedAmount,
    send: vi.fn(),
  } as unknown as WebSocket & { send: ReturnType<typeof vi.fn> };
}

function callHandler(
  handlers: Handlers,
  method: "llm.infer" | "llm.cancel",
  params: Record<string, unknown>,
  socket = makeSocket(),
) {
  return new Promise<{
    ok: boolean;
    payload?: unknown;
    error?: { code: string; message: string };
    socket: ReturnType<typeof makeSocket>;
  }>((resolve) => {
    const respond = (ok: boolean, payload?: unknown, error?: { code: string; message: string }) =>
      resolve({ ok, payload, error, socket });
    void handlers[method]({
      params,
      req: { _socket: socket },
      respond,
    } as never);
  });
}

function makeRequest(overrides?: Partial<LlmInferRequest>): LlmInferRequest {
  return {
    requestId: "req-1",
    model: "fake/model",
    messages: [{ role: "user", content: "hello" }],
    ...overrides,
  };
}

describe("llm.infer handlers", () => {
  it("streams seq-ordered chunks then returns final usage", async () => {
    const provider: MeshLlmProvider = {
      canServe: (model) => model === "fake/model",
      infer: async function* () {
        yield { delta: "hel" };
        yield { delta: "lo" };
        return { finishReason: "stop", usage: { inputTokens: 1, outputTokens: 2 } };
      },
    };
    const handlers = createLlmInferenceHandlers({ provider });
    const socket = makeSocket();

    const result = await callHandler(handlers, "llm.infer", makeRequest() as unknown as Record<string, unknown>, socket);

    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({
      requestId: "req-1",
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 2 },
    });
    const sent = socket.send.mock.calls.map(([raw]) => JSON.parse(String(raw)));
    expect(sent).toEqual([
      { type: "event", event: "llm.chunk", payload: { requestId: "req-1", seq: 0, delta: "hel" } },
      { type: "event", event: "llm.chunk", payload: { requestId: "req-1", seq: 1, delta: "lo" } },
    ]);
  });

  it("rejects unavailable models and concurrent inference", async () => {
    let release!: () => void;
    const provider: MeshLlmProvider = {
      canServe: (model) => model === "fake/model",
      infer: async function* () {
        await new Promise<void>((resolve) => { release = resolve; });
      },
    };
    const handlers = createLlmInferenceHandlers({ provider });
    const first = callHandler(handlers, "llm.infer", makeRequest() as unknown as Record<string, unknown>);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));

    const busy = await callHandler(handlers, "llm.infer", makeRequest({ requestId: "req-2" }) as unknown as Record<string, unknown>);
    const unavailable = await callHandler(
      handlers,
      "llm.infer",
      makeRequest({ requestId: "req-3", model: "missing/model" }) as unknown as Record<string, unknown>,
    );
    release();
    await first;

    expect(busy.ok).toBe(false);
    expect(busy.error?.code).toBe("LLM_BUSY");
    expect(unavailable.ok).toBe(false);
    expect(unavailable.error?.code).toBe("LLM_MODEL_UNAVAILABLE");
  });

  it("aborts before sending a chunk when socket buffer is over limit", async () => {
    const provider: MeshLlmProvider = {
      canServe: () => true,
      infer: async function* () {
        yield { delta: "blocked" };
      },
    };
    const handlers = createLlmInferenceHandlers({ provider, maxBufferedAmount: 5 });
    const socket = makeSocket(6);

    const result = await callHandler(handlers, "llm.infer", makeRequest() as unknown as Record<string, unknown>, socket);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("LLM_BACKPRESSURE");
    expect(socket.send).not.toHaveBeenCalled();
  });

  it("cancels an in-flight request with final finishReason cancelled", async () => {
    let sawAbort = false;
    const provider: MeshLlmProvider = {
      canServe: () => true,
      infer: async function* (_request, opts) {
        while (!opts.signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        sawAbort = true;
        return { finishReason: "cancelled" };
      },
    };
    const handlers = createLlmInferenceHandlers({ provider, timeoutMs: 2_000 });
    const infer = callHandler(handlers, "llm.infer", makeRequest() as unknown as Record<string, unknown>);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const cancel = await callHandler(handlers, "llm.cancel", { requestId: "req-1" });
    const final = await infer;

    expect(cancel.ok).toBe(true);
    expect(cancel.payload).toEqual({ requestId: "req-1", cancelled: true });
    expect(final.ok).toBe(true);
    expect(final.payload).toMatchObject({ requestId: "req-1", finishReason: "cancelled" });
    expect(sawAbort).toBe(true);
  });
});
