export type LlmInferRole = "system" | "user" | "assistant";

export type LlmInferMessage = {
  role: LlmInferRole;
  content: string;
};

export type LlmUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export type LlmFinishReason = "stop" | "length" | "cancelled";

export type LlmInferRequest = {
  requestId: string;
  model: string;
  messages: LlmInferMessage[];
  maxTokens?: number;
  temperature?: number;
};

export type LlmChunkEvent = {
  requestId: string;
  seq: number;
  delta: string;
};

export type LlmProviderChunk = {
  delta: string;
};

export type LlmProviderFinal = {
  finishReason: LlmFinishReason;
  usage?: LlmUsage;
};

export type LlmInferResult = LlmProviderFinal & {
  requestId: string;
};

export type MeshLlmProvider = {
  canServe(model: string): boolean;
  infer(
    request: LlmInferRequest,
    opts: { signal: AbortSignal },
  ): AsyncGenerator<LlmProviderChunk, LlmProviderFinal | void, unknown>;
};

