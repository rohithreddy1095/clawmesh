import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CredentialStore } from "./credential-store.js";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("CredentialStore", () => {
  let tempDir: string;
  let store: CredentialStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "clawmesh-cred-test-"));
    store = new CredentialStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("set + get round-trips a credential", () => {
    store.set("provider/google", "AIzaSy...", "My Google key");
    expect(store.get("provider/google")).toBe("AIzaSy...");
    expect(store.getEntry("provider/google")?.label).toBe("My Google key");
  });

  it("persists across instances", () => {
    store.set("channel/telegram", "123:ABC");
    const store2 = new CredentialStore(tempDir);
    expect(store2.get("channel/telegram")).toBe("123:ABC");
  });

  it("delete removes a credential", () => {
    store.set("provider/openai", "sk-xyz");
    expect(store.has("provider/openai")).toBe(true);
    store.delete("provider/openai");
    expect(store.has("provider/openai")).toBe(false);
    expect(store.get("provider/openai")).toBeUndefined();
  });

  it("list masks values", () => {
    store.set("provider/google", "AIzaSyDpDuaUv6lmsdfdQFHdTE2DR1KheVHXi_s");
    const entries = store.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe("provider/google");
    expect(entries[0].masked).toBe("AIza…Xi_s");
    expect(entries[0].masked).not.toContain("sdfd");
  });

  it("injectProviderEnvVars sets GEMINI_API_KEY for google", () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      store.set("provider/google", "test-gemini-key");
      const injected = store.injectProviderEnvVars();
      expect(injected).toContain("GEMINI_API_KEY");
      expect(process.env.GEMINI_API_KEY).toBe("test-gemini-key");
    } finally {
      if (prev) process.env.GEMINI_API_KEY = prev;
      else delete process.env.GEMINI_API_KEY;
    }
  });

  it("injectProviderEnvVars does NOT override existing env vars", () => {
    process.env.GEMINI_API_KEY = "already-set";
    try {
      store.set("provider/google", "from-store");
      const injected = store.injectProviderEnvVars();
      expect(injected).not.toContain("GEMINI_API_KEY");
      expect(process.env.GEMINI_API_KEY).toBe("already-set");
    } finally {
      delete process.env.GEMINI_API_KEY;
    }
  });

  it("file has restrictive permissions (600)", () => {
    store.set("provider/test", "secret");
    const filePath = join(tempDir, "credentials.json");
    expect(existsSync(filePath)).toBe(true);
    const stat = statSync(filePath);
    const mode = (stat.mode & 0o777).toString(8);
    expect(mode).toBe("600");
  });

  it("getChannelToken / setChannelToken convenience methods", () => {
    store.setChannelToken("telegram", "bot-token-123", "Pandu Telegram bot");
    expect(store.getChannelToken("telegram")).toBe("bot-token-123");
    expect(store.getEntry("channel/telegram")?.label).toBe("Pandu Telegram bot");
  });

  it("keys returns all stored keys", () => {
    store.set("provider/google", "a");
    store.set("channel/telegram", "b");
    store.set("custom/farm-id", "c");
    expect(store.keys().sort()).toEqual([
      "channel/telegram",
      "custom/farm-id",
      "provider/google",
    ]);
  });

  it("handles empty/fresh store gracefully", () => {
    expect(store.keys()).toHaveLength(0);
    expect(store.get("nonexistent")).toBeUndefined();
    expect(store.list()).toHaveLength(0);
    expect(store.injectProviderEnvVars()).toHaveLength(0);
  });

  it("envVarForProvider returns correct mapping", () => {
    expect(CredentialStore.envVarForProvider("google")).toBe("GEMINI_API_KEY");
    expect(CredentialStore.envVarForProvider("anthropic")).toBe("ANTHROPIC_API_KEY");
    expect(CredentialStore.envVarForProvider("openai")).toBe("OPENAI_API_KEY");
    expect(CredentialStore.envVarForProvider("unknown")).toBeUndefined();
  });
});
