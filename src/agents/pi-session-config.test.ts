import { describe, it, expect } from "vitest";
import {
  resolvePiSessionConfig,
  validatePiSessionModelSpec,
  getDefaultModelSpec,
  getDefaultThinkingLevel,
  getDefaultProactiveIntervalMs,
} from "./pi-session-config.js";

describe("resolvePiSessionConfig", () => {
  it("applies all defaults when no opts", () => {
    const config = resolvePiSessionConfig({});
    expect(config.modelSpec).toBe("anthropic/claude-sonnet-4-5-20250929");
    expect(config.thinkingLevel).toBe("off");
    expect(config.proactiveIntervalMs).toBe(60_000);
  });

  it("uses provided model spec", () => {
    const config = resolvePiSessionConfig({ piSessionModelSpec: "google/gemini-pro" });
    expect(config.modelSpec).toBe("google/gemini-pro");
  });

  it("uses provided thinking level", () => {
    const config = resolvePiSessionConfig({ piSessionThinkingLevel: "high" });
    expect(config.thinkingLevel).toBe("high");
  });

  it("uses provided interval", () => {
    const config = resolvePiSessionConfig({ plannerProactiveIntervalMs: 30_000 });
    expect(config.proactiveIntervalMs).toBe(30_000);
  });

  it("handles all options together", () => {
    const config = resolvePiSessionConfig({
      piSessionModelSpec: "openai/gpt-4o",
      piSessionThinkingLevel: "medium",
      plannerProactiveIntervalMs: 120_000,
    });
    expect(config.modelSpec).toBe("openai/gpt-4o");
    expect(config.thinkingLevel).toBe("medium");
    expect(config.proactiveIntervalMs).toBe(120_000);
  });

  it("zero interval is valid", () => {
    const config = resolvePiSessionConfig({ plannerProactiveIntervalMs: 0 });
    expect(config.proactiveIntervalMs).toBe(0);
  });
});

describe("validatePiSessionModelSpec", () => {
  it("accepts valid spec", () => {
    expect(validatePiSessionModelSpec("anthropic/claude-sonnet-4-5-20250929")).toBeNull();
  });

  it("accepts nested model path", () => {
    expect(validatePiSessionModelSpec("azure/gpt-4/turbo")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(validatePiSessionModelSpec("")).not.toBeNull();
  });

  it("rejects provider only", () => {
    expect(validatePiSessionModelSpec("anthropic")).not.toBeNull();
  });

  it("rejects trailing slash", () => {
    expect(validatePiSessionModelSpec("anthropic/")).not.toBeNull();
  });

  it("error message includes the spec", () => {
    const err = validatePiSessionModelSpec("bad");
    expect(err).toContain("bad");
  });
});

describe("defaults", () => {
  it("default model spec", () => {
    expect(getDefaultModelSpec()).toContain("anthropic");
  });

  it("default thinking level is off", () => {
    expect(getDefaultThinkingLevel()).toBe("off");
  });

  it("default proactive interval is 60s", () => {
    expect(getDefaultProactiveIntervalMs()).toBe(60_000);
  });
});
