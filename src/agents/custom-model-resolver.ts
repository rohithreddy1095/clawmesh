import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";

type OpenAICompatibleApi = "openai-completions" | "openai-responses" | "openai-codex-responses";

type CustomProviderConfig = {
  baseUrl?: string;
  api?: Api;
  apiKey?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  models?: Array<{
    id: string;
    name?: string;
    api?: Api;
    reasoning?: boolean;
    input?: Array<"text" | "image">;
    contextWindow?: number;
    maxTokens?: number;
    cost?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
    };
    headers?: Record<string, string>;
    compat?: Record<string, unknown>;
  }>;
};

type CustomModelsFile = {
  providers?: Record<string, CustomProviderConfig>;
};

export type ResolvedCustomPiModel = {
  model: Model<any>;
  apiKey?: string;
};

export function getDefaultPiModelsConfigPath(): string {
  return join(homedir(), ".pi", "agent", "models.json");
}

export function resolveCustomPiModel(
  provider: string,
  modelId: string,
  opts?: {
    modelsConfigPath?: string;
    env?: NodeJS.ProcessEnv;
    runCommand?: (command: string) => string;
  },
): ResolvedCustomPiModel | null {
  const modelsConfigPath = opts?.modelsConfigPath ?? getDefaultPiModelsConfigPath();
  if (!existsSync(modelsConfigPath)) return null;

  let parsed: CustomModelsFile;
  try {
    parsed = JSON.parse(readFileSync(modelsConfigPath, "utf8")) as CustomModelsFile;
  } catch {
    return null;
  }

  const providerConfig = parsed.providers?.[provider];
  if (!providerConfig?.models?.length) return null;

  const modelConfig = providerConfig.models.find(model => model.id === modelId);
  if (!modelConfig) return null;

  const api = modelConfig.api ?? providerConfig.api;
  const baseUrl = providerConfig.baseUrl;
  if (!api || !baseUrl) return null;

  const env = opts?.env ?? process.env;
  const runCommand = opts?.runCommand ?? ((command: string) => execSync(command, { encoding: "utf8" }));
  const apiKey = resolveConfiguredValue(providerConfig.apiKey, env, runCommand);
  const headers = resolveHeaders({
    ...providerConfig.headers,
    ...modelConfig.headers,
  }, env, runCommand);

  return {
    apiKey,
    model: {
      id: modelConfig.id,
      name: modelConfig.name ?? modelConfig.id,
      api,
      provider,
      baseUrl,
      reasoning: modelConfig.reasoning ?? false,
      input: modelConfig.input ?? ["text"],
      cost: {
        input: modelConfig.cost?.input ?? 0,
        output: modelConfig.cost?.output ?? 0,
        cacheRead: modelConfig.cost?.cacheRead ?? 0,
        cacheWrite: modelConfig.cost?.cacheWrite ?? 0,
      },
      contextWindow: modelConfig.contextWindow ?? 128_000,
      maxTokens: modelConfig.maxTokens ?? 16_384,
      headers,
      compat: {
        ...(providerConfig.compat ?? {}),
        ...(modelConfig.compat ?? {}),
      } as any,
    } satisfies Model<any>,
  };
}

export function injectCustomPiModelApiKey(
  model: Model<any>,
  apiKey: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!apiKey) return;

  const targetEnvVar = getEnvVarForCustomModelApi(model.api);
  if (!targetEnvVar) return;
  if (env[targetEnvVar]) return;
  env[targetEnvVar] = apiKey;
}

function resolveConfiguredValue(
  value: string | undefined,
  env: NodeJS.ProcessEnv,
  runCommand: (command: string) => string,
): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("!")) {
    const output = runCommand(value.slice(1)).trim();
    return output || undefined;
  }
  return env[value] ?? value;
}

function resolveHeaders(
  headers: Record<string, string> | undefined,
  env: NodeJS.ProcessEnv,
  runCommand: (command: string) => string,
): Record<string, string> | undefined {
  if (!headers) return undefined;

  const resolved = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, resolveConfiguredValue(value, env, runCommand) ?? value]),
  );

  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

function getEnvVarForCustomModelApi(api: Api): string | null {
  switch (api as OpenAICompatibleApi | Api) {
    case "openai-completions":
    case "openai-responses":
    case "openai-codex-responses":
      return "OPENAI_API_KEY";
    case "anthropic-messages":
      return "ANTHROPIC_API_KEY";
    case "google-generative-ai":
      return "GEMINI_API_KEY";
    default:
      return null;
  }
}
