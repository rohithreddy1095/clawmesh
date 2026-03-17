import { describe, it, expect } from "vitest";
import {
  buildOperatorPrompt,
  buildPlannerPrompt,
  extractCitations,
  cleanIntentText,
  parseModelSpec,
  type TriggerEntry,
  type PatternSummary,
} from "./planner-prompt-builder.js";
import type { ContextFrame } from "../mesh/context-types.js";

// ─── Helpers ────────────────────────────────────────

function makeTrigger(overrides: Partial<TriggerEntry> = {}): TriggerEntry {
  return { reason: "test trigger", priority: 1, ...overrides };
}

function makePattern(overrides: Partial<PatternSummary> = {}): PatternSummary {
  return {
    triggerCondition: "moisture < 20%",
    action: { operation: "start", targetRef: "actuator:pump:P1" },
    confidence: 0.85,
    approvalCount: 5,
    rejectionCount: 1,
    ...overrides,
  };
}

function makeFrame(overrides: Partial<ContextFrame> = {}): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "device-abc",
    timestamp: Date.now(),
    data: { metric: "moisture", value: 42, zone: "zone-1" },
    trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T1_unverified_observation" },
    ...overrides,
  };
}

// ─── buildOperatorPrompt ────────────────────────────

describe("buildOperatorPrompt", () => {
  it("includes operator message text", () => {
    const result = buildOperatorPrompt("check zone 1", [], []);
    expect(result).toContain('[OPERATOR MESSAGE] "check zone 1"');
  });

  it("includes system triggers when present", () => {
    const triggers = [makeTrigger({ reason: "moisture breach" })];
    const result = buildOperatorPrompt("status", triggers, []);
    expect(result).toContain("moisture breach");
    expect(result).toContain("system triggers");
  });

  it("omits system context when no triggers", () => {
    const result = buildOperatorPrompt("hello", [], []);
    expect(result).not.toContain("system triggers");
  });

  it("includes pattern context when present", () => {
    const patterns = [makePattern()];
    const result = buildOperatorPrompt("status", [], patterns);
    expect(result).toContain("LEARNED PATTERNS");
    expect(result).toContain("moisture < 20%");
    expect(result).toContain("actuator:pump:P1");
    expect(result).toContain("85%");
  });

  it("omits patterns when empty", () => {
    const result = buildOperatorPrompt("hello", [], []);
    expect(result).not.toContain("LEARNED PATTERNS");
  });

  it("limits patterns to 10", () => {
    const patterns = Array.from({ length: 15 }, (_, i) =>
      makePattern({ triggerCondition: `pattern-${i}` }),
    );
    const result = buildOperatorPrompt("test", [], patterns);
    expect(result).toContain("pattern-9");
    expect(result).not.toContain("pattern-10");
  });

  it("includes instructions about propose_task", () => {
    const result = buildOperatorPrompt("start pump", [], []);
    expect(result).toContain("propose_task");
    expect(result).toContain("sensor citations");
  });
});

// ─── buildPlannerPrompt ─────────────────────────────

describe("buildPlannerPrompt", () => {
  it("includes PLANNER CYCLE header with timestamp", () => {
    const result = buildPlannerPrompt([makeTrigger()]);
    expect(result).toContain("[PLANNER CYCLE");
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}/); // ISO date
  });

  it("includes trigger reasons as bullet points", () => {
    const triggers = [
      makeTrigger({ reason: "moisture breach zone-1" }),
      makeTrigger({ reason: "temperature high zone-2" }),
    ];
    const result = buildPlannerPrompt(triggers);
    expect(result).toContain("- moisture breach zone-1");
    expect(result).toContain("- temperature high zone-2");
  });

  it("includes instructions about propose_task and L2/L3", () => {
    const result = buildPlannerPrompt([makeTrigger()]);
    expect(result).toContain("propose_task");
    expect(result).toContain("L2/L3");
    expect(result).toContain("L0");
  });

  it("includes safety instruction about not fabricating data", () => {
    const result = buildPlannerPrompt([makeTrigger()]);
    expect(result).toContain("Never fabricate sensor data");
  });
});

// ─── extractCitations ───────────────────────────────

describe("extractCitations", () => {
  it("extracts citations from observation frames", () => {
    const frames = [
      makeFrame({ data: { metric: "moisture", value: 42, zone: "zone-1" } }),
    ];
    const citations = extractCitations(frames);
    expect(citations).toHaveLength(1);
    expect(citations[0]).toEqual({
      metric: "moisture",
      value: 42,
      zone: "zone-1",
      timestamp: expect.any(Number),
    });
  });

  it("skips non-observation frames", () => {
    const frames = [
      makeFrame({ kind: "event", data: { metric: "pump", value: "started" } }),
      makeFrame({ kind: "observation", data: { metric: "temp", value: 28 } }),
    ];
    const citations = extractCitations(frames);
    expect(citations).toHaveLength(1);
    expect(citations[0].metric).toBe("temp");
  });

  it("skips frames without metric", () => {
    const frames = [
      makeFrame({ data: { description: "manual check", value: "ok" } }),
    ];
    const citations = extractCitations(frames);
    expect(citations).toHaveLength(0);
  });

  it("respects maxCount parameter", () => {
    const frames = Array.from({ length: 10 }, (_, i) =>
      makeFrame({ data: { metric: `m${i}`, value: i } }),
    );
    expect(extractCitations(frames, 3)).toHaveLength(3);
  });

  it("returns empty for empty input", () => {
    expect(extractCitations([])).toEqual([]);
  });

  it("handles undefined zone", () => {
    const frames = [makeFrame({ data: { metric: "temp", value: 30 } })];
    const citations = extractCitations(frames);
    expect(citations[0].zone).toBeUndefined();
  });
});

// ─── cleanIntentText ────────────────────────────────

describe("cleanIntentText", () => {
  it("strips operator_intent prefix", () => {
    expect(cleanIntentText('operator_intent: "check zone 1"')).toBe("check zone 1");
  });

  it("strips with no space after colon", () => {
    expect(cleanIntentText('operator_intent:"hello"')).toBe("hello");
  });

  it("handles already clean text", () => {
    expect(cleanIntentText("just a message")).toBe("just a message");
  });

  it("strips trailing quote only", () => {
    // The regex targets operator_intent prefix — standalone quotes are only stripped at the end
    expect(cleanIntentText('check status"')).toBe("check status");
  });

  it("handles empty string", () => {
    expect(cleanIntentText("")).toBe("");
  });
});

// ─── parseModelSpec ─────────────────────────────────

describe("parseModelSpec", () => {
  it("parses standard provider/model spec", () => {
    const result = parseModelSpec("anthropic/claude-sonnet-4-5-20250929");
    expect(result).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-5-20250929",
    });
  });

  it("handles provider with nested model path", () => {
    const result = parseModelSpec("openai/gpt-4/turbo");
    expect(result).toEqual({
      provider: "openai",
      modelId: "gpt-4/turbo",
    });
  });

  it("throws on empty string", () => {
    expect(() => parseModelSpec("")).toThrow("Invalid model spec");
  });

  it("throws on provider-only (no slash)", () => {
    expect(() => parseModelSpec("anthropic")).toThrow("Invalid model spec");
  });

  it("throws on trailing slash (no model)", () => {
    expect(() => parseModelSpec("anthropic/")).toThrow("Invalid model spec");
  });

  it("error message includes the invalid spec", () => {
    expect(() => parseModelSpec("bad")).toThrow('"bad"');
  });

  it("error message suggests correct format", () => {
    expect(() => parseModelSpec("bad")).toThrow("provider/model-id");
  });
});
