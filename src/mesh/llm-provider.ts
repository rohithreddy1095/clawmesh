import {
  streamSimple,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type Usage,
} from "@mariozechner/pi-ai";
import { resolvePiModel } from "../agents/pi-model-resolver.js";
import type {
  LlmFinishReason,
  LlmInferMessage,
  LlmInferRequest,
  LlmProviderFinal,
  MeshLlmProvider,
} from "./llm-types.js";

export type PiLlmProviderOptions = {
  modelSpecs: string[];
  log?: {
    info?: (msg: string) => void;
  };
};

export function createPiLlmProvider(opts: PiLlmProviderOptions): MeshLlmProvider {
  const models = new Map<string, Model<any>>();
  for (const spec of opts.modelSpecs) {
    const normalized = spec.trim();
    if (!normalized) {
      continue;
    }
    models.set(normalized, resolvePiModel(normalized, opts.log));
  }

  return {
    canServe: (model) => models.has(model),
    infer: async function* (request: LlmInferRequest, streamOpts: { signal: AbortSignal }) {
      const model = models.get(request.model);
      if (!model) {
        throw new Error(`model is not served by this node: ${request.model}`);
      }

      const stream = streamSimple(model, toPiContext(request.messages, model), {
        signal: streamOpts.signal,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
      });

      let final: LlmProviderFinal = { finishReason: "stop" };
      for await (const event of stream) {
        if (event.type === "text_delta") {
          yield { delta: event.delta };
          continue;
        }
        if (event.type === "done") {
          final = {
            finishReason: mapStopReason(event.reason),
            usage: mapUsage(event.message.usage),
          };
        } else if (event.type === "error") {
          if (event.reason === "aborted" || streamOpts.signal.aborted) {
            final = {
              finishReason: "cancelled",
              usage: mapUsage(event.error.usage),
            };
          } else {
            throw new Error(event.error.errorMessage ?? "LLM provider stream error");
          }
        }
      }

      return final;
    },
  };
}

function toPiContext(messages: LlmInferMessage[], model: Model<any>): Context {
  const systemMessages = messages.filter((message) => message.role === "system");
  const conversationalMessages = messages.filter((message) => message.role !== "system");
  return {
    systemPrompt: systemMessages.map((message) => message.content).join("\n\n") || undefined,
    messages: conversationalMessages.map((message) => toPiMessage(message, model)),
  };
}

function toPiMessage(message: LlmInferMessage, model: Model<any>): Message {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: [{ type: "text", text: message.content }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: zeroUsage(),
      stopReason: "stop",
      timestamp: Date.now(),
    } satisfies AssistantMessage;
  }

  return {
    role: "user",
    content: message.content,
    timestamp: Date.now(),
  };
}

function zeroUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function mapStopReason(reason: string): LlmFinishReason {
  if (reason === "length") {
    return "length";
  }
  if (reason === "aborted") {
    return "cancelled";
  }
  return "stop";
}

function mapUsage(usage: Usage | undefined) {
  if (!usage) {
    return undefined;
  }
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
  };
}

