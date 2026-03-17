import { describe, it, expect } from "vitest";
import {
  ingestFrame,
  isPatternFrame,
  extractPatterns,
  type ThresholdBreach,
} from "./frame-ingestor.js";
import type { ContextFrame } from "../mesh/context-types.js";
import type { ThresholdRule } from "./types.js";

function makeFrame(overrides: Partial<ContextFrame> = {}): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "device-abc",
    timestamp: Date.now(),
    data: { metric: "moisture", value: 15, zone: "zone-1" },
    trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T1_unverified_observation" },
    ...overrides,
  };
}

function makeRule(overrides: Partial<ThresholdRule> = {}): ThresholdRule {
  return {
    ruleId: "rule-1",
    metric: "moisture",
    zone: "zone-1",
    belowThreshold: 20,
    cooldownMs: 300_000,
    promptHint: "Moisture is critically low",
    ...overrides,
  };
}

// ─── ingestFrame ────────────────────────────────────

describe("ingestFrame", () => {
  it("detects pattern import frame", () => {
    const frame = makeFrame({
      kind: "capability_update",
      data: { type: "learned_patterns", patterns: [{}, {}, {}] },
    });
    const result = ingestFrame(frame, [], new Map());
    expect(result.action).toBe("pattern_import");
    expect(result.patternCount).toBe(3);
    expect(result.breaches).toEqual([]);
  });

  it("detects pattern import with non-array patterns", () => {
    const frame = makeFrame({
      kind: "capability_update",
      data: { type: "learned_patterns", patterns: "not_array" },
    });
    const result = ingestFrame(frame, [], new Map());
    expect(result.action).toBe("pattern_import");
    expect(result.patternCount).toBe(0);
  });

  it("detects threshold breach", () => {
    const rule = makeRule({ belowThreshold: 20 });
    const frame = makeFrame({ data: { metric: "moisture", value: 15, zone: "zone-1" } });
    const result = ingestFrame(frame, [rule], new Map());
    expect(result.action).toBe("threshold_check");
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0]).toEqual({
      ruleId: "rule-1",
      promptHint: "Moisture is critically low",
      metric: "moisture",
      zone: "zone-1",
      value: 15,
    });
  });

  it("skips non-breaching observation", () => {
    const rule = makeRule({ belowThreshold: 20 });
    const frame = makeFrame({ data: { metric: "moisture", value: 25, zone: "zone-1" } });
    const result = ingestFrame(frame, [rule], new Map());
    expect(result.action).toBe("skip");
    expect(result.breaches).toEqual([]);
  });

  it("respects cooldown", () => {
    const rule = makeRule({ cooldownMs: 60_000 });
    const lastFired = new Map([["rule-1", Date.now() - 30_000]]); // 30s ago
    const frame = makeFrame({ data: { metric: "moisture", value: 15, zone: "zone-1" } });
    const result = ingestFrame(frame, [rule], lastFired);
    expect(result.breaches).toEqual([]);
  });

  it("fires after cooldown expires", () => {
    const now = Date.now();
    const rule = makeRule({ cooldownMs: 60_000 });
    const lastFired = new Map([["rule-1", now - 61_000]]); // 61s ago
    const frame = makeFrame({ data: { metric: "moisture", value: 15, zone: "zone-1" } });
    const result = ingestFrame(frame, [rule], lastFired, now);
    expect(result.breaches).toHaveLength(1);
  });

  it("updates lastFiredMap on breach", () => {
    const now = Date.now();
    const lastFired = new Map<string, number>();
    const rule = makeRule();
    const frame = makeFrame({ data: { metric: "moisture", value: 15, zone: "zone-1" } });
    ingestFrame(frame, [rule], lastFired, now);
    expect(lastFired.get("rule-1")).toBe(now);
  });

  it("handles multiple rules, some breached", () => {
    const rules = [
      makeRule({ ruleId: "r1", metric: "moisture", belowThreshold: 20 }),
      makeRule({ ruleId: "r2", metric: "temperature", aboveThreshold: 35, zone: undefined }),
    ];
    const frame = makeFrame({ data: { metric: "moisture", value: 10, zone: "zone-1" } });
    const result = ingestFrame(frame, rules, new Map());
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0].ruleId).toBe("r1");
  });

  it("skips event frames for threshold checks", () => {
    const rule = makeRule();
    const frame = makeFrame({
      kind: "event",
      data: { metric: "moisture", value: 5, zone: "zone-1" },
    });
    const result = ingestFrame(frame, [rule], new Map());
    expect(result.action).toBe("skip");
  });

  it("skips frames with wrong metric", () => {
    const rule = makeRule({ metric: "temperature" });
    const frame = makeFrame({ data: { metric: "moisture", value: 5, zone: "zone-1" } });
    const result = ingestFrame(frame, [rule], new Map());
    expect(result.breaches).toEqual([]);
  });

  it("skips frames with wrong zone", () => {
    const rule = makeRule({ zone: "zone-2" });
    const frame = makeFrame({ data: { metric: "moisture", value: 5, zone: "zone-1" } });
    const result = ingestFrame(frame, [rule], new Map());
    expect(result.breaches).toEqual([]);
  });

  it("handles above threshold", () => {
    const rule = makeRule({
      ruleId: "temp-high",
      metric: "temperature",
      aboveThreshold: 40,
      belowThreshold: undefined,
      zone: undefined,
      promptHint: "Temperature too high",
    });
    const frame = makeFrame({ data: { metric: "temperature", value: 45 } });
    const result = ingestFrame(frame, [rule], new Map());
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0].value).toBe(45);
  });

  it("handles dual threshold (below and above)", () => {
    const rule = makeRule({
      ruleId: "ph-range",
      metric: "ph",
      belowThreshold: 5.5,
      aboveThreshold: 8.0,
      zone: undefined,
      promptHint: "pH out of range",
    });
    // Below threshold
    const frameLow = makeFrame({ data: { metric: "ph", value: 4.0 } });
    expect(ingestFrame(frameLow, [rule], new Map()).breaches).toHaveLength(1);

    // Above threshold
    const frameHigh = makeFrame({ data: { metric: "ph", value: 9.0 } });
    expect(ingestFrame(frameHigh, [rule], new Map()).breaches).toHaveLength(1);

    // Within range
    const frameOk = makeFrame({ data: { metric: "ph", value: 7.0 } });
    expect(ingestFrame(frameOk, [rule], new Map()).breaches).toHaveLength(0);
  });

  it("returns skip for empty rules array", () => {
    const frame = makeFrame();
    expect(ingestFrame(frame, [], new Map()).action).toBe("skip");
  });

  it("handles non-numeric value gracefully", () => {
    const rule = makeRule();
    const frame = makeFrame({ data: { metric: "moisture", value: "high", zone: "zone-1" } });
    const result = ingestFrame(frame, [rule], new Map());
    expect(result.breaches).toEqual([]);
  });
});

// ─── isPatternFrame ─────────────────────────────────

describe("isPatternFrame", () => {
  it("returns true for valid pattern frame", () => {
    const frame = makeFrame({
      kind: "capability_update",
      data: { type: "learned_patterns", patterns: [{ a: 1 }] },
    });
    expect(isPatternFrame(frame)).toBe(true);
  });

  it("returns false for non-capability_update", () => {
    const frame = makeFrame({
      kind: "observation",
      data: { type: "learned_patterns", patterns: [] },
    });
    expect(isPatternFrame(frame)).toBe(false);
  });

  it("returns false when type is not learned_patterns", () => {
    const frame = makeFrame({
      kind: "capability_update",
      data: { type: "other", patterns: [] },
    });
    expect(isPatternFrame(frame)).toBe(false);
  });

  it("returns false when patterns is not an array", () => {
    const frame = makeFrame({
      kind: "capability_update",
      data: { type: "learned_patterns", patterns: "bad" },
    });
    expect(isPatternFrame(frame)).toBe(false);
  });
});

// ─── extractPatterns ────────────────────────────────

describe("extractPatterns", () => {
  it("extracts patterns from valid frame", () => {
    const frame = makeFrame({
      kind: "capability_update",
      data: { type: "learned_patterns", patterns: [{ a: 1 }, { b: 2 }] },
    });
    expect(extractPatterns(frame)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("returns empty for non-pattern frame", () => {
    expect(extractPatterns(makeFrame())).toEqual([]);
  });

  it("returns empty for invalid patterns field", () => {
    const frame = makeFrame({
      kind: "capability_update",
      data: { type: "learned_patterns", patterns: null },
    });
    expect(extractPatterns(frame)).toEqual([]);
  });
});
