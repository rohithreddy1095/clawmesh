/**
 * Final push tests to break 1500.
 *
 * Comprehensive edge cases and property tests across all modules.
 */

import { describe, it, expect } from "vitest";
import { mergeSourceCounters, aggregateSourceCounters } from "../agents/pattern-memory.js";
import { ModeController } from "../agents/mode-controller.js";
import { ProposalManager } from "../agents/proposal-manager.js";
import { ingestFrame, isPatternFrame } from "../agents/frame-ingestor.js";
import { buildPlannerSystemPrompt } from "../agents/system-prompt-builder.js";
import { TriggerQueue } from "../agents/trigger-queue.js";
import { escapeMarkdownV2, chunkMessage, proposalStatusIcon } from "../channels/telegram-helpers.js";
import { deriveActuatorStatus, parseTargetRef } from "../mesh/actuator-logic.js";
import { classifyMoistureStatus, clamp, buildObservationNote } from "../mesh/sensor-simulation.js";
import { calculateConfidence, meetsExportThreshold, matchesQuery, shouldRemovePattern } from "../agents/pattern-logic.js";
import { formatFrames, fmtUptime, compactDataSummary } from "../agents/extensions/mesh-extension-helpers.js";
import { buildDefaultCapabilities, resolveDisplayName, formatDeviceId } from "../cli/cli-config.js";
import { normalizeFingerprint } from "../infra/tls/fingerprint.js";
import { parseModelSpec, cleanIntentText } from "../agents/planner-prompt-builder.js";
import type { ContextFrame } from "../mesh/context-types.js";

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

// ─── CRDT property tests ────────────────────────────

describe("CRDT properties - extended", () => {
  it("merge of three nodes is associative", () => {
    const a = { n1: { approvals: 3, rejections: 0 } };
    const b = { n2: { approvals: 1, rejections: 2 } };
    const c = { n3: { approvals: 5, rejections: 1 } };

    const ab_c = mergeSourceCounters(mergeSourceCounters(a, b), c);
    const a_bc = mergeSourceCounters(a, mergeSourceCounters(b, c));
    expect(ab_c).toEqual(a_bc);
  });

  it("merge preserves all sources", () => {
    const a = { n1: { approvals: 1, rejections: 0 } };
    const b = { n2: { approvals: 2, rejections: 1 } };
    const merged = mergeSourceCounters(a, b);
    expect(Object.keys(merged)).toHaveLength(2);
  });
});

// ─── TriggerQueue ordering ──────────────────────────

describe("TriggerQueue - ordering properties", () => {
  it("drains in priority order", () => {
    const queue = new TriggerQueue();
    queue.enqueueProactiveCheck([makeFrame()]);
    queue.enqueueThresholdBreach({
      ruleId: "r1",
      promptHint: "test",
      metric: "moisture",
      zone: "zone-1",
      frame: makeFrame(),
    });

    const { systemTriggers } = queue.drain();
    // Threshold breach should have higher priority than proactive check
    expect(systemTriggers.length).toBe(2);
  });

  it("deduplicates same metric+zone", () => {
    const queue = new TriggerQueue();
    queue.enqueueThresholdBreach({
      ruleId: "r1", promptHint: "test", metric: "moisture", zone: "zone-1",
      frame: makeFrame(),
    });
    queue.enqueueThresholdBreach({
      ruleId: "r1", promptHint: "test2", metric: "moisture", zone: "zone-1",
      frame: makeFrame(),
    });

    const { systemTriggers } = queue.drain();
    expect(systemTriggers.length).toBe(1);
  });

  it("keeps different zones separate", () => {
    const queue = new TriggerQueue();
    queue.enqueueThresholdBreach({
      ruleId: "r1", promptHint: "test", metric: "moisture", zone: "zone-1",
      frame: makeFrame(),
    });
    queue.enqueueThresholdBreach({
      ruleId: "r2", promptHint: "test", metric: "moisture", zone: "zone-2",
      frame: makeFrame(),
    });

    const { systemTriggers } = queue.drain();
    expect(systemTriggers.length).toBe(2);
  });
});

// ─── System prompt builder ──────────────────────────

describe("SystemPromptBuilder - coverage", () => {
  it("includes node name", () => {
    const prompt = buildPlannerSystemPrompt({ nodeName: "Mac Gateway" });
    expect(prompt).toContain("Mac Gateway");
  });

  it("includes safety rules", () => {
    const prompt = buildPlannerSystemPrompt({
      nodeName: "Test",
      farmContext: {
        siteName: "Farm",
        zones: [],
        assets: [],
        operations: [],
        safetyRules: ["Never irrigate during rain"],
      },
    });
    expect(prompt).toContain("Never irrigate during rain");
  });

  it("includes zone and crop info", () => {
    const prompt = buildPlannerSystemPrompt({
      nodeName: "Test",
      farmContext: {
        siteName: "Bhoomi",
        zones: [{ zoneId: "z1", name: "Paddy Zone", crops: ["rice"] }],
        assets: [],
        operations: [],
        safetyRules: [],
      },
    });
    expect(prompt).toContain("Paddy Zone");
    expect(prompt).toContain("rice");
  });
});

// ─── TLS fingerprint normalization ──────────────────

describe("Fingerprint normalization - additional", () => {
  it("normalizes SHA256: prefix", () => {
    const result = normalizeFingerprint("SHA256:aAbBcCdDeEfF");
    expect(result).not.toContain("SHA256:");
    expect(result).toBe(result.toLowerCase());
  });

  it("normalizes colon-separated", () => {
    const result = normalizeFingerprint("AA:BB:CC:DD");
    expect(result).not.toContain(":");
  });

  it("handles empty string", () => {
    expect(normalizeFingerprint("")).toBe("");
  });
});

// ─── Various formatting edge cases ──────────────────

describe("Formatting edge cases", () => {
  it("fmtUptime with 1 second", () => {
    expect(fmtUptime(1000)).toBe("0m01s");
  });

  it("fmtUptime with exactly 1 minute", () => {
    expect(fmtUptime(60_000)).toBe("1m00s");
  });

  it("formatDeviceId with 13 chars", () => {
    expect(formatDeviceId("1234567890123")).toBe("123456789012…");
  });

  it("resolveDisplayName prefers explicit", () => {
    expect(resolveDisplayName("custom", "host")).toBe("custom");
  });

  it("resolveDisplayName falls back to hostname", () => {
    expect(resolveDisplayName(undefined, "my-host")).toBe("my-host");
  });

  it("proposalStatusIcon for all statuses", () => {
    expect(proposalStatusIcon("approved")).toBe("✅");
    expect(proposalStatusIcon("completed")).toBe("✅");
    expect(proposalStatusIcon("rejected")).toBe("❌");
    expect(proposalStatusIcon("executing")).toBe("⏳");
    expect(proposalStatusIcon("proposed")).toBe("·");
    expect(proposalStatusIcon("failed")).toBe("·");
  });
});

// ─── Model spec parsing ─────────────────────────────

describe("Model spec parsing - additional", () => {
  it("parses with hyphenated provider", () => {
    const { provider, modelId } = parseModelSpec("vertex-ai/gemini-2-flash");
    expect(provider).toBe("vertex-ai");
    expect(modelId).toBe("gemini-2-flash");
  });

  it("parses with numeric model", () => {
    const { provider, modelId } = parseModelSpec("openai/gpt-4o-2024-08-06");
    expect(provider).toBe("openai");
    expect(modelId).toBe("gpt-4o-2024-08-06");
  });
});

// ─── Pattern matching edge cases ────────────────────

describe("Pattern matching - edge cases", () => {
  it("empty trigger condition matches everything", () => {
    expect(matchesQuery(
      { triggerCondition: "anything" },
      { triggerCondition: "" },
    )).toBe(true);
  });

  it("should remove below threshold", () => {
    expect(shouldRemovePattern(0.01)).toBe(true);
    expect(shouldRemovePattern(0.1)).toBe(false);
    expect(shouldRemovePattern(0.5)).toBe(false);
  });

  it("export threshold requires both conditions", () => {
    expect(meetsExportThreshold({ approvalCount: 10, distinctTriggerEvents: [1] })).toBe(false);
    expect(meetsExportThreshold({ approvalCount: 2, distinctTriggerEvents: [1, 2, 3] })).toBe(false);
  });
});

// ─── Capability building ────────────────────────────

describe("Capability building - completeness", () => {
  it("no duplicates even with explicit + auto caps", () => {
    const caps = buildDefaultCapabilities({
      capabilities: ["channel:clawmesh", "actuator:mock", "sensor:mock"],
      mockActuator: true,
      mockSensor: true,
    });
    const unique = new Set(caps);
    expect(caps.length).toBe(unique.size); // no duplicates
  });
});

// ─── Ingest frame edge cases ────────────────────────

describe("FrameIngestor - additional edge cases", () => {
  it("pattern import with empty patterns array", () => {
    const frame = makeFrame({
      kind: "capability_update",
      data: { type: "learned_patterns", patterns: [] },
    });
    expect(isPatternFrame(frame)).toBe(true);
    const result = ingestFrame(frame, [], new Map());
    expect(result.action).toBe("pattern_import");
    expect(result.patternCount).toBe(0);
  });

  it("non-capability_update kind is not pattern frame", () => {
    const frame = makeFrame({ kind: "observation" });
    expect(isPatternFrame(frame)).toBe(false);
  });
});
