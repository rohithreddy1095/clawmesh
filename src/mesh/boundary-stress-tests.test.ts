/**
 * Comprehensive boundary tests for all extracted architecture modules.
 *
 * Tests extreme/edge cases: empty inputs, null values, boundary numbers,
 * Unicode, very long strings, and concurrent-like scenarios.
 */

import { describe, it, expect } from "vitest";
import { ModeController } from "../agents/mode-controller.js";
import { ProposalManager } from "../agents/proposal-manager.js";
import { ingestFrame } from "../agents/frame-ingestor.js";
import { buildOperatorPrompt, buildPlannerPrompt } from "../agents/planner-prompt-builder.js";
import { classifyEvent } from "../agents/session-event-classifier.js";
import { calculateConfidence, decayConfidence, patternKey, matchesQuery } from "../agents/pattern-logic.js";
import { formatFrames, compactDataSummary, fmtUptime } from "../agents/extensions/mesh-extension-helpers.js";
import { deriveActuatorStatus, parseTargetRef } from "../mesh/actuator-logic.js";
import { simulateMoistureStep, classifyMoistureStatus, clamp } from "../mesh/sensor-simulation.js";
import { escapeMarkdownV2, chunkMessage, formatCitations } from "../channels/telegram-helpers.js";
import { expandShorthandFlags, parseNumericOption, checkRequiredEnvVars } from "../cli/cli-config.js";
import type { ContextFrame } from "../mesh/context-types.js";
import type { TaskProposal } from "../agents/types.js";

function makeFrame(overrides: Partial<ContextFrame> = {}): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-test`,
    sourceDeviceId: "device-abc",
    timestamp: Date.now(),
    data: { metric: "moisture", value: 42, zone: "zone-1" },
    trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T1_unverified_observation" },
    ...overrides,
  };
}

function makeProposal(overrides: Partial<TaskProposal> = {}): TaskProposal {
  return {
    taskId: "t-1",
    summary: "Test",
    reasoning: "Test reason",
    targetRef: "actuator:pump:P1",
    operation: "start",
    peerDeviceId: "peer-1",
    approvalLevel: "L2",
    status: "awaiting_approval",
    createdBy: "intelligence",
    triggerFrameIds: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

// ─── Unicode and special character handling ──────────

describe("Unicode handling across modules", () => {
  it("formatFrames handles Unicode in data", () => {
    const frame = makeFrame({
      sourceDisplayName: "Capteur 日本語",
      data: { metric: "humidité", value: 42, zone: "zone-café" },
      note: "Température élevée 🌡️",
    });
    const result = formatFrames([frame]);
    expect(result).toContain("Capteur 日本語");
    expect(result).toContain("humidité");
    expect(result).toContain("🌡️");
  });

  it("escapeMarkdownV2 handles Unicode", () => {
    expect(escapeMarkdownV2("Température: 30°C")).toContain("Température");
  });

  it("patternKey with Unicode", () => {
    const key = patternKey("humidité < 20%", "démarrer", "actuateur:pompe:P1");
    expect(key).toContain("humidité");
    expect(key).toContain("démarrer");
  });

  it("compactDataSummary with Unicode zone", () => {
    expect(compactDataSummary({ zone: "zone-α", metric: "pH", value: 7.0 }))
      .toBe("zone-α pH=7");
  });

  it("parseTargetRef with Unicode identifier", () => {
    const result = parseTargetRef("sensor:température:zone-été");
    expect(result.subtype).toBe("température");
    expect(result.identifier).toBe("zone-été");
  });
});

// ─── Extreme numeric values ─────────────────────────

describe("Extreme numeric values", () => {
  it("fmtUptime with very large ms", () => {
    const result = fmtUptime(1e10); // ~115 days
    expect(result).toContain("h");
  });

  it("simulateMoistureStep with negative values", () => {
    // Should reset to 35 since below 5
    const result = simulateMoistureStep(-10, 0, 0);
    expect(result).toBe(35);
  });

  it("clamp with Infinity", () => {
    expect(clamp(Infinity, 0, 100)).toBe(100);
    expect(clamp(-Infinity, 0, 100)).toBe(0);
  });

  it("calculateConfidence with very large numbers", () => {
    expect(calculateConfidence(1000000, 1)).toBeCloseTo(1.0, 5);
  });

  it("decayConfidence with very old timestamp", () => {
    const result = decayConfidence(1.0, 0, Date.now(), 1000, 0.5);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it("parseNumericOption with Infinity string", () => {
    expect(parseNumericOption("Infinity", 0)).toBe(Infinity);
  });

  it("classifyMoistureStatus with negative", () => {
    expect(classifyMoistureStatus(-5)).toBe("critical");
  });

  it("classifyMoistureStatus with very high", () => {
    expect(classifyMoistureStatus(999)).toBe("normal");
  });
});

// ─── Empty and null handling ────────────────────────

describe("Empty input handling", () => {
  it("formatFrames with single empty-data frame", () => {
    const frame = makeFrame({ data: {} });
    const result = formatFrames([frame]);
    expect(result).toContain("[observation]");
  });

  it("buildOperatorPrompt with empty intent", () => {
    const result = buildOperatorPrompt("", [], []);
    expect(result).toContain('[OPERATOR MESSAGE] ""');
  });

  it("buildPlannerPrompt with empty triggers", () => {
    // Should not crash
    const result = buildPlannerPrompt([]);
    expect(result).toContain("PLANNER CYCLE");
  });

  it("compactDataSummary with all-empty fields", () => {
    expect(compactDataSummary({})).toBe("{}");
  });

  it("formatCitations with empty array", () => {
    expect(formatCitations([])).toBe("");
  });

  it("checkRequiredEnvVars with empty requirements", () => {
    expect(checkRequiredEnvVars([])).toEqual([]);
  });

  it("expandShorthandFlags with all undefined", () => {
    const result = expandShorthandFlags({});
    expect(result.piPlanner).toBeUndefined();
  });
});

// ─── Very long strings ──────────────────────────────

describe("Very long string handling", () => {
  it("chunkMessage with very long text", () => {
    const text = "x".repeat(20000);
    const chunks = chunkMessage(text, 4000);
    expect(chunks.length).toBe(5);
    chunks.forEach(c => expect(c.length).toBeLessThanOrEqual(4000));
  });

  it("escapeMarkdownV2 with many special chars", () => {
    const text = "!@#$%^&*()_+-=[]{}|;':\",./<>?".repeat(100);
    const result = escapeMarkdownV2(text);
    expect(result.length).toBeGreaterThan(text.length); // Escaped chars add length
  });

  it("deriveActuatorStatus with long operation name", () => {
    const result = deriveActuatorStatus("x".repeat(1000));
    expect(result).toContain("command:");
  });

  it("patternKey with very long inputs", () => {
    const key = patternKey("a".repeat(500), "b".repeat(500), "c".repeat(500));
    expect(key.length).toBe(1502); // 500 + "|" + 500 + "|" + 500
  });
});

// ─── ModeController stress test ─────────────────────

describe("ModeController - stress scenarios", () => {
  it("handles rapid error/success alternation", () => {
    const mc = new ModeController({ errorThreshold: 3 });
    for (let i = 0; i < 100; i++) {
      mc.recordFailure("err", false);
      mc.recordSuccess();
    }
    expect(mc.mode).toBe("active");
    expect(mc.consecutiveErrors).toBe(0);
  });

  it("handles 100 consecutive failures then resume", () => {
    const mc = new ModeController({ errorThreshold: 1 });
    for (let i = 0; i < 100; i++) {
      mc.recordFailure("err", false);
    }
    expect(mc.mode).toBe("observing");
    expect(mc.consecutiveErrors).toBe(100);
    mc.resume();
    expect(mc.mode).toBe("active");
    expect(mc.consecutiveErrors).toBe(0);
  });
});

// ─── ProposalManager stress ─────────────────────────

describe("ProposalManager - stress", () => {
  it("handles 100 proposals", () => {
    const pm = new ProposalManager();
    for (let i = 0; i < 100; i++) {
      pm.add(makeProposal({ taskId: `t-${i}`, status: i % 2 === 0 ? "awaiting_approval" : "completed" }));
    }
    expect(pm.size).toBe(100);
    expect(pm.countPending()).toBe(50);
    expect(pm.list({ status: "completed" })).toHaveLength(50);
  });
});

// ─── FrameIngestor with many rules ──────────────────

describe("FrameIngestor - many rules", () => {
  it("checks all rules against a frame", () => {
    const rules = Array.from({ length: 50 }, (_, i) => ({
      ruleId: `rule-${i}`,
      metric: i === 25 ? "moisture" : `metric-${i}`,
      belowThreshold: 20,
      cooldownMs: 0,
      promptHint: `Hint ${i}`,
    }));
    const frame = makeFrame({ data: { metric: "moisture", value: 15 } });
    const result = ingestFrame(frame, rules, new Map());
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0].ruleId).toBe("rule-25");
  });
});

// ─── Event classifier edge cases ────────────────────

describe("SessionEventClassifier - extreme inputs", () => {
  it("handles very deeply nested content", () => {
    const result = classifyEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
          { type: "text", text: "c" },
          { type: "text", text: "d" },
          { type: "text", text: "e" },
        ],
      },
    });
    expect(result.type).toBe("assistant_text");
    if (result.type === "assistant_text") {
      expect(result.text).toContain("a");
      expect(result.text).toContain("e");
    }
  });
});

// ─── matchesQuery edge cases ────────────────────────

describe("matchesQuery - complex scenarios", () => {
  it("all criteria match", () => {
    expect(matchesQuery(
      { metric: "moisture", zone: "zone-1", triggerCondition: "moisture below 20%" },
      { metric: "moisture", zone: "zone-1", triggerCondition: "moisture" },
    )).toBe(true);
  });

  it("no criteria matches everything", () => {
    expect(matchesQuery(
      { metric: "anything", zone: "anywhere", triggerCondition: "whatever" },
      {},
    )).toBe(true);
  });

  it("partial triggerCondition match", () => {
    expect(matchesQuery(
      { triggerCondition: "soil moisture below critical threshold in zone-1" },
      { triggerCondition: "moisture" },
    )).toBe(true);
  });
});
