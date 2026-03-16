import { describe, it, expect } from "vitest";
import { checkThresholdBreach, isPermanentLLMError } from "./threshold-checker.js";
import type { ThresholdRule } from "./types.js";
import type { ContextFrame } from "../mesh/context-types.js";

function makeFrame(overrides?: Partial<ContextFrame>): ContextFrame {
  return {
    kind: "observation",
    frameId: "f1",
    sourceDeviceId: "dev",
    timestamp: Date.now(),
    data: { metric: "soil_moisture", value: 15, zone: "zone-1" },
    trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    ...overrides,
  };
}

function makeRule(overrides?: Partial<ThresholdRule>): ThresholdRule {
  return {
    ruleId: "moisture-critical",
    metric: "soil_moisture",
    belowThreshold: 20,
    cooldownMs: 300_000,
    promptHint: "Moisture critically low",
    ...overrides,
  };
}

describe("checkThresholdBreach", () => {
  const now = Date.now();

  // ─── Basic breach detection ────────────────

  it("detects below-threshold breach", () => {
    expect(checkThresholdBreach(makeRule(), makeFrame(), 0, now)).toBe(true);
  });

  it("does not breach when value is above threshold", () => {
    expect(checkThresholdBreach(
      makeRule(),
      makeFrame({ data: { metric: "soil_moisture", value: 25, zone: "zone-1" } }),
      0, now,
    )).toBe(false);
  });

  it("detects above-threshold breach", () => {
    expect(checkThresholdBreach(
      makeRule({ aboveThreshold: 40, belowThreshold: undefined }),
      makeFrame({ data: { metric: "soil_moisture", value: 45, zone: "zone-1" } }),
      0, now,
    )).toBe(true);
  });

  it("detects exact threshold value (below)", () => {
    // value === belowThreshold → NOT breached (need to be strictly below)
    expect(checkThresholdBreach(
      makeRule({ belowThreshold: 15 }),
      makeFrame({ data: { metric: "soil_moisture", value: 15, zone: "zone-1" } }),
      0, now,
    )).toBe(false);
  });

  // ─── Frame type filtering ─────────────────

  it("ignores non-observation frames", () => {
    expect(checkThresholdBreach(
      makeRule(),
      makeFrame({ kind: "event" }),
      0, now,
    )).toBe(false);
  });

  it("ignores human_input frames", () => {
    expect(checkThresholdBreach(
      makeRule(),
      makeFrame({ kind: "human_input" }),
      0, now,
    )).toBe(false);
  });

  // ─── Metric matching ──────────────────────

  it("ignores frames with wrong metric", () => {
    expect(checkThresholdBreach(
      makeRule({ metric: "temperature" }),
      makeFrame({ data: { metric: "soil_moisture", value: 10, zone: "z" } }),
      0, now,
    )).toBe(false);
  });

  it("ignores frames without a metric string", () => {
    expect(checkThresholdBreach(
      makeRule(),
      makeFrame({ data: { value: 10 } }),
      0, now,
    )).toBe(false);
  });

  // ─── Zone filtering ───────────────────────

  it("matches when rule has no zone (global rule)", () => {
    expect(checkThresholdBreach(
      makeRule({ zone: undefined }),
      makeFrame(),
      0, now,
    )).toBe(true);
  });

  it("matches when zones match", () => {
    expect(checkThresholdBreach(
      makeRule({ zone: "zone-1" }),
      makeFrame(),
      0, now,
    )).toBe(true);
  });

  it("rejects when zones differ", () => {
    expect(checkThresholdBreach(
      makeRule({ zone: "zone-2" }),
      makeFrame({ data: { metric: "soil_moisture", value: 10, zone: "zone-1" } }),
      0, now,
    )).toBe(false);
  });

  // ─── Value type handling ──────────────────

  it("ignores non-numeric values", () => {
    expect(checkThresholdBreach(
      makeRule(),
      makeFrame({ data: { metric: "soil_moisture", value: "low", zone: "z" } }),
      0, now,
    )).toBe(false);
  });

  // ─── Cooldown ─────────────────────────────

  it("blocks when within cooldown period", () => {
    const lastFired = now - 60_000; // 1 minute ago
    expect(checkThresholdBreach(
      makeRule({ cooldownMs: 300_000 }), // 5 min cooldown
      makeFrame(),
      lastFired, now,
    )).toBe(false);
  });

  it("allows when cooldown has elapsed", () => {
    const lastFired = now - 600_000; // 10 minutes ago
    expect(checkThresholdBreach(
      makeRule({ cooldownMs: 300_000 }), // 5 min cooldown
      makeFrame(),
      lastFired, now,
    )).toBe(true);
  });

  it("uses default 5-minute cooldown when not specified", () => {
    const lastFired = now - 200_000; // 3.3 minutes ago (< 5 min default)
    expect(checkThresholdBreach(
      makeRule({ cooldownMs: undefined }),
      makeFrame(),
      lastFired, now,
    )).toBe(false);
  });

  it("first fire always succeeds (lastFired = 0)", () => {
    expect(checkThresholdBreach(makeRule(), makeFrame(), 0, now)).toBe(true);
  });

  // ─── Dual threshold ───────────────────────

  it("supports both below and above thresholds on same rule", () => {
    const rule = makeRule({ belowThreshold: 10, aboveThreshold: 40 });

    // Below
    expect(checkThresholdBreach(
      rule,
      makeFrame({ data: { metric: "soil_moisture", value: 5, zone: "zone-1" } }),
      0, now,
    )).toBe(true);

    // Above
    expect(checkThresholdBreach(
      rule,
      makeFrame({ data: { metric: "soil_moisture", value: 45, zone: "zone-1" } }),
      0, now,
    )).toBe(true);

    // In range — no breach
    expect(checkThresholdBreach(
      rule,
      makeFrame({ data: { metric: "soil_moisture", value: 25, zone: "zone-1" } }),
      0, now,
    )).toBe(false);
  });
});

describe("isPermanentLLMError", () => {
  it("detects 403 Forbidden", () => {
    expect(isPermanentLLMError(new Error("HTTP 403 Forbidden"))).toBe(true);
  });

  it("detects 401 Unauthorized", () => {
    expect(isPermanentLLMError(new Error("401 Unauthorized"))).toBe(true);
  });

  it("detects account disabled", () => {
    expect(isPermanentLLMError("Your account has been disabled")).toBe(true);
  });

  it("detects terms of service violation", () => {
    expect(isPermanentLLMError("Violation of terms of service")).toBe(true);
  });

  it("does NOT flag rate limits as permanent", () => {
    expect(isPermanentLLMError(new Error("429 Too Many Requests"))).toBe(false);
  });

  it("does NOT flag network errors as permanent", () => {
    expect(isPermanentLLMError(new Error("ECONNRESET"))).toBe(false);
  });

  it("does NOT flag timeout as permanent", () => {
    expect(isPermanentLLMError(new Error("Request timed out after 30000ms"))).toBe(false);
  });

  it("does NOT flag 500 server errors as permanent", () => {
    expect(isPermanentLLMError(new Error("500 Internal Server Error"))).toBe(false);
  });

  it("handles null/undefined", () => {
    expect(isPermanentLLMError(null)).toBe(false);
    expect(isPermanentLLMError(undefined)).toBe(false);
  });

  it("handles number inputs", () => {
    expect(isPermanentLLMError(403)).toBe(true);
    expect(isPermanentLLMError(401)).toBe(true);
    expect(isPermanentLLMError(429)).toBe(false);
    expect(isPermanentLLMError(500)).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isPermanentLLMError("FORBIDDEN")).toBe(true);
    expect(isPermanentLLMError("Unauthorized")).toBe(true);
  });

  it("handles Error objects with stack traces", () => {
    const err = new Error("API Error: 403 Forbidden");
    err.stack = "Error: API Error: 403 Forbidden\n    at fetch (/path/to/file.js:42)";
    expect(isPermanentLLMError(err)).toBe(true);
  });
});
