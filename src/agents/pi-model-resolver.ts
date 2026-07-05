import { getModel, type Model } from "@mariozechner/pi-ai";
import { injectCustomPiModelApiKey, resolveCustomPiModel } from "./custom-model-resolver.js";
import { parseModelSpec } from "./planner-prompt-builder.js";

export type ResolvePiModelLogger = {
  info?: (msg: string) => void;
};

export function resolvePiModel(spec: string, log?: ResolvePiModelLogger): Model<any> {
  const { provider, modelId } = parseModelSpec(spec);

  if (provider === "nanochat") {
    const port = process.env.NANOCHAT_PORT ?? "8000";
    const host = process.env.NANOCHAT_HOST ?? "127.0.0.1";
    if (!process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = "local";
    }
    log?.info?.(`pi-model: using local NanoChat model "${modelId}" at http://${host}:${port}`);
    return {
      id: `nanochat-${modelId}`,
      name: `NanoChat ${modelId.toUpperCase()} (local)`,
      api: "openai-completions",
      provider: "openai",
      baseUrl: `http://${host}:${port}/v1`,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 2048,
      maxTokens: 512,
      compat: {
        supportsStore: false,
      },
    } satisfies Model<"openai-completions">;
  }

  const customModel = resolveCustomPiModel(provider, modelId);
  if (customModel) {
    injectCustomPiModelApiKey(customModel.model, customModel.apiKey);
    log?.info?.(`pi-model: using custom model "${provider}/${modelId}" at ${customModel.model.baseUrl}`);
    return customModel.model;
  }

  const model = getModel(provider as any, modelId as any);
  if (!model) {
    throw new Error(
      `Model "${modelId}" not found for provider "${provider}". ` +
      `Check available models with: pi-ai models ${provider}`,
    );
  }
  return model;
}
