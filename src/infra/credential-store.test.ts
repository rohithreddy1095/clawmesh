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
    store.set("provider/google", "test-google-credential-value", "My Google key");
    expect(store.get("provider/google")).toBe("test-google-credential-value");
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
    store.set("provider/google", "test-google-credential-value");
    const entries = store.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe("provider/google");
    expect(entries[0].masked).toMatch(/^\[redacted len=\d+ sha256=[0-9a-f]{12}\]$/);
    expect(entries[0].masked).not.toContain("test-google");
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

  // ─── Additional coverage ───────────────────

  it("maskValue produces consistent hash for same input", () => {
    const mask1 = CredentialStore.maskValue("sk-abc123");
    const mask2 = CredentialStore.maskValue("sk-abc123");
    expect(mask1).toBe(mask2);
    expect(mask1).toContain("[redacted");
    expect(mask1).toContain("len=9"); // "sk-abc123" is 9 chars
    expect(mask1).not.toContain("sk-abc123"); // Must not leak the value
  });

  it("maskValue produces different hashes for different inputs", () => {
    const mask1 = CredentialStore.maskValue("key-1");
    const mask2 = CredentialStore.maskValue("key-2");
    expect(mask1).not.toBe(mask2);
  });

  it("maskValue includes length", () => {
    const mask = CredentialStore.maskValue("x".repeat(50));
    expect(mask).toContain("len=50");
  });

  it("envVarForProvider covers all major providers", () => {
    const providers = ["google", "anthropic", "openai", "groq", "xai", "mistral"];
    for (const p of providers) {
      expect(CredentialStore.envVarForProvider(p)).toBeTruthy();
    }
  });

  it("injectProviderEnvVars does not overwrite existing env vars", () => {
    const origVal = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "existing-key";

    store.set("provider/google", "new-key");
    const injected = store.injectProviderEnvVars();

    // Should NOT have injected because env var already exists
    expect(injected).not.toContain("GEMINI_API_KEY");
    expect(process.env.GEMINI_API_KEY).toBe("existing-key");

    // Cleanup
    if (origVal === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = origVal;
    }
  });

  it("getEntry returns full metadata", () => {
    store.set("test/key", "val", "My Label");
    const entry = store.getEntry("test/key");
    expect(entry?.value).toBe("val");
    expect(entry?.label).toBe("My Label");
    expect(entry?.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("has returns false for deleted key", () => {
    store.set("temp", "val");
    expect(store.has("temp")).toBe(true);
    store.delete("temp");
    expect(store.has("temp")).toBe(false);
  });

  it("list masks all values", () => {
    store.set("key1", "secret1");
    store.set("key2", "secret2");
    const listing = store.list();
    for (const item of listing) {
      expect(item.masked).toContain("[redacted");
      expect(item.masked).not.toContain("secret");
    }
  });
});
