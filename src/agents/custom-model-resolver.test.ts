import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { injectCustomPiModelApiKey, resolveCustomPiModel } from "./custom-model-resolver.js";

describe("resolveCustomPiModel", () => {
  it("loads a local OpenAI-compatible model from pi models.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "clawmesh-custom-model-"));
    const configPath = join(dir, "models.json");

    writeFileSync(configPath, JSON.stringify({
      providers: {
        "local-llama": {
          baseUrl: "http://127.0.0.1:8010/v1",
          api: "openai-completions",
          apiKey: "local",
          compat: {
            supportsDeveloperRole: false,
            maxTokensField: "max_tokens",
          },
          models: [
            {
              id: "gemma-4-E2B-it",
              name: "Gemma 4 E2B (llama.cpp local)",
              reasoning: false,
              input: ["text"],
              contextWindow: 8192,
              maxTokens: 2048,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
            },
          ],
        },
      },
    }), "utf8");

    try {
      const resolved = resolveCustomPiModel("local-llama", "gemma-4-E2B-it", { modelsConfigPath: configPath });
      expect(resolved).not.toBeNull();
      expect(resolved?.apiKey).toBe("local");
      expect(resolved?.model.provider).toBe("local-llama");
      expect(resolved?.model.baseUrl).toBe("http://127.0.0.1:8010/v1");
      expect(resolved?.model.id).toBe("gemma-4-E2B-it");
      expect(resolved?.model.compat).toMatchObject({
        supportsDeveloperRole: false,
        maxTokensField: "max_tokens",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves env-var and command-backed api keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "clawmesh-custom-model-"));
    const configPath = join(dir, "models.json");

    writeFileSync(configPath, JSON.stringify({
      providers: {
        proxy: {
          baseUrl: "http://127.0.0.1:9999/v1",
          api: "openai-completions",
          apiKey: "LOCAL_LLM_KEY",
          headers: {
            "x-secret": "!printf command-secret",
          },
          models: [
            {
              id: "demo-model",
            },
          ],
        },
      },
    }), "utf8");

    try {
      const resolved = resolveCustomPiModel("proxy", "demo-model", {
        modelsConfigPath: configPath,
        env: { LOCAL_LLM_KEY: "env-secret" } as NodeJS.ProcessEnv,
        runCommand: () => "command-secret\n",
      });
      expect(resolved?.apiKey).toBe("env-secret");
      expect(resolved?.model.headers).toEqual({ "x-secret": "command-secret" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when provider or model is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "clawmesh-custom-model-"));
    const configPath = join(dir, "models.json");

    writeFileSync(configPath, JSON.stringify({ providers: {} }), "utf8");

    try {
      expect(resolveCustomPiModel("missing", "model", { modelsConfigPath: configPath })).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("injectCustomPiModelApiKey", () => {
  it("maps OpenAI-compatible custom models to OPENAI_API_KEY", () => {
    const env: NodeJS.ProcessEnv = {};
    injectCustomPiModelApiKey({
      id: "gemma-4-E2B-it",
      name: "Gemma 4 E2B",
      api: "openai-completions",
      provider: "local-llama",
      baseUrl: "http://127.0.0.1:8010/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 2048,
    }, "local", env);

    expect(env.OPENAI_API_KEY).toBe("local");
  });
});
