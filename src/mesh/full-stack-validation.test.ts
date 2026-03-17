/**
 * Full-stack architecture validation tests.
 *
 * Validates that all extracted modules integrate correctly by testing
 * realistic multi-module scenarios from end to end.
 */

import { describe, it, expect } from "vitest";
import { ModeController } from "../agents/mode-controller.js";
import { ProposalManager } from "../agents/proposal-manager.js";
import { ingestFrame, isPatternFrame, extractPatterns } from "../agents/frame-ingestor.js";
import { buildOperatorPrompt, extractCitations, cleanIntentText, parseModelSpec } from "../agents/planner-prompt-builder.js";
import { classifyEvent, extractAssistantText } from "../agents/session-event-classifier.js";
import {
  calculateConfidence, meetsExportThreshold, patternKey,
  decayConfidence, matchesQuery,
} from "../agents/pattern-logic.js";
import { formatFrames, compactDataSummary, fmtUptime } from "../agents/extensions/mesh-extension-helpers.js";
import { deriveActuatorStatus, parseTargetRef, isActuatorRef } from "../mesh/actuator-logic.js";
import { classifyMoistureStatus, simulateMoistureStep, buildObservationPayload } from "../mesh/sensor-simulation.js";
import { escapeMarkdownV2, chunkMessage, meetsAlertSeverity, proposalStatusIcon } from "../channels/telegram-helpers.js";
import { expandShorthandFlags, getDefaultThresholds, formatDeviceId } from "../cli/cli-config.js";
import { checkThresholdBreach } from "../agents/threshold-checker.js";
import type { ContextFrame } from "../mesh/context-types.js";
import type { ThresholdRule, TaskProposal } from "../agents/types.js";

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

function makeProposal(overrides: Partial<TaskProposal> = {}): TaskProposal {
  return {
    taskId: "task-12345678",
    summary: "Start pump P1",
    reasoning: "Moisture critically low",
    targetRef: "actuator:pump:P1",
    operation: "start",
    peerDeviceId: "peer-abc",
    approvalLevel: "L2",
    status: "awaiting_approval",
    createdBy: "intelligence",
    triggerFrameIds: ["f-abc"],
    createdAt: Date.now(),
    ...overrides,
  };
}

// ─── Scenario 1: Sensor → Threshold → Trigger → Proposal ──

describe("E2E: Sensor observation triggers planner cycle", () => {
  it("sensor reading → threshold breach → trigger generation", () => {
    // 1. Simulate sensor reading
    const moisture = simulateMoistureStep(30, 16, 0); // Force to 14%
    expect(moisture).toBe(14);
    const status = classifyMoistureStatus(moisture);
    expect(status).toBe("critical");

    // 2. Build observation payload
    const payload = buildObservationPayload({
      zone: "zone-1",
      metric: "moisture",
      value: moisture,
      unit: "%",
      threshold: 20,
    });
    expect(payload.status).toBe("critical");

    // 3. Create context frame
    const frame = makeFrame({
      data: { ...payload },
    });

    // 4. Check threshold
    const rule: ThresholdRule = getDefaultThresholds()[0]; // moisture-critical at 20
    const breached = checkThresholdBreach(rule, frame, 0, Date.now());
    expect(breached).toBe(true);

    // 5. Ingest frame
    const result = ingestFrame(frame, [rule], new Map());
    expect(result.action).toBe("threshold_check");
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0].value).toBe(14);
  });

  it("proposal lifecycle from creation to completion", () => {
    const pm = new ProposalManager();
    const p = makeProposal();
    pm.add(p);

    // Approve
    pm.approve(p.taskId);
    expect(p.status).toBe("approved");

    // Derive status
    const status = deriveActuatorStatus(p.operation);
    expect(status).toBe("active");

    // Complete
    pm.complete(p.taskId, { ok: true });
    expect(p.status).toBe("completed");

    // Status icon
    expect(proposalStatusIcon(p.status)).toBe("✅");
  });
});

// ─── Scenario 2: Pattern learning and gossip ─────────

describe("E2E: Pattern learning from operator decisions", () => {
  it("approval builds confidence toward gossip threshold", () => {
    const key = patternKey("moisture < 20%", "start", "actuator:pump:P1");
    expect(key).toContain("moisture");

    // Simulate 3 approvals
    let confidence = calculateConfidence(3, 0);
    expect(confidence).toBe(1.0);

    // Check export threshold
    expect(meetsExportThreshold({
      approvalCount: 3,
      distinctTriggerEvents: ["e1", "e2"],
    })).toBe(true);

    // Pattern matching
    expect(matchesQuery(
      { metric: "moisture", zone: "zone-1", triggerCondition: "moisture < 20%" },
      { metric: "moisture", zone: "zone-1" },
    )).toBe(true);
  });

  it("patterns decay over time", () => {
    const now = Date.now();
    const twoWeeksAgo = now - 14 * 24 * 3600_000;
    const decayed = decayConfidence(1.0, twoWeeksAgo, now, 7 * 24 * 3600_000, 0.9);
    expect(decayed).toBeCloseTo(0.81, 1); // 0.9^2
  });

  it("pattern import from context frame", () => {
    const patternFrame = makeFrame({
      kind: "capability_update",
      data: {
        type: "learned_patterns",
        patterns: [{ patternId: "test", confidence: 0.9 }],
      },
    });
    expect(isPatternFrame(patternFrame)).toBe(true);
    const patterns = extractPatterns(patternFrame);
    expect(patterns).toHaveLength(1);
  });
});

// ─── Scenario 3: LLM mode management ────────────────

describe("E2E: LLM failure → observing → recovery", () => {
  it("error accumulation → mode transition → recovery", () => {
    const mc = new ModeController({ errorThreshold: 3 });

    // Normal operation
    expect(mc.canMakeLLMCalls()).toBe(true);

    // Errors accumulate
    mc.recordFailure("timeout", false);
    mc.recordFailure("rate limit", false);
    expect(mc.mode).toBe("active");

    // Third error triggers observing
    mc.recordFailure("server error", false);
    expect(mc.mode).toBe("observing");
    expect(mc.canMakeLLMCalls()).toBe(false);

    // LLM probe succeeds
    mc.recordSuccess();
    expect(mc.mode).toBe("active");
    expect(mc.canMakeLLMCalls()).toBe(true);
  });
});

// ─── Scenario 4: Telegram notification flow ──────────

describe("E2E: Proposal → Telegram notification", () => {
  it("formats proposal for Telegram delivery", () => {
    const proposal = makeProposal();
    const escaped = escapeMarkdownV2(proposal.summary);
    expect(escaped).toContain("Start pump P1");

    const deviceId = formatDeviceId(proposal.peerDeviceId);
    expect(deviceId.length).toBeLessThanOrEqual(13); // 12 + ellipsis

    const ref = parseTargetRef(proposal.targetRef);
    expect(ref.type).toBe("actuator");
    expect(ref.subtype).toBe("pump");
    expect(ref.identifier).toBe("P1");
    expect(isActuatorRef(proposal.targetRef)).toBe(true);
  });

  it("long messages are chunked", () => {
    const longMsg = "Important update:\n".repeat(300);
    const chunks = chunkMessage(longMsg, 4000);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach(c => expect(c.length).toBeLessThanOrEqual(4000));
  });
});

// ─── Scenario 5: CLI configuration ──────────────────

describe("E2E: CLI flag expansion → runtime configuration", () => {
  it("field-node flag produces correct configuration", () => {
    const opts = expandShorthandFlags({ fieldNode: true });
    expect(opts.mockSensor).toBe(true);
    expect(opts.mockActuator).toBe(true);

    const thresholds = getDefaultThresholds();
    expect(thresholds.length).toBeGreaterThan(0);
    expect(thresholds[0].metric).toBe("moisture");
  });

  it("model spec parsing for planner", () => {
    const { provider, modelId } = parseModelSpec("anthropic/claude-sonnet-4-5-20250929");
    expect(provider).toBe("anthropic");
    expect(modelId).toBe("claude-sonnet-4-5-20250929");
  });
});

// ─── Scenario 6: World model query and formatting ───

describe("E2E: World model frames → formatted output", () => {
  it("formats frames for LLM context", () => {
    const frames = [
      makeFrame({ sourceDisplayName: "Jetson", data: { metric: "moisture", value: 18, zone: "zone-1" } }),
      makeFrame({ sourceDisplayName: "Mac", data: { metric: "temp", value: 32, zone: "zone-2" } }),
    ];

    const formatted = formatFrames(frames);
    expect(formatted).toContain("Jetson");
    expect(formatted).toContain("Mac");
    expect(formatted).toContain("moisture");

    const citations = extractCitations(frames);
    expect(citations).toHaveLength(2);
  });

  it("compact summary for gossip display", () => {
    expect(compactDataSummary({ zone: "zone-1", metric: "moisture", value: 18, unit: "%" }))
      .toBe("zone-1 moisture=18%");
  });

  it("uptime formatting", () => {
    expect(fmtUptime(3_661_000)).toBe("1h01m");
  });
});

// ─── Scenario 7: Event classification pipeline ──────

describe("E2E: Agent events → classification → response", () => {
  it("classifies and extracts assistant response", () => {
    const event = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Moisture in zone-1 is at 18%. I recommend starting pump P1." },
        ],
      },
    };

    const classified = classifyEvent(event);
    expect(classified.type).toBe("assistant_text");

    const text = extractAssistantText(event.message);
    expect(text).toContain("zone-1");
    expect(text).toContain("pump P1");
  });

  it("operator intent → prompt building", () => {
    const raw = 'operator_intent: "should I irrigate zone 1?"';
    const cleaned = cleanIntentText(raw);
    expect(cleaned).toBe("should I irrigate zone 1?");

    const prompt = buildOperatorPrompt(cleaned, [], []);
    expect(prompt).toContain("should I irrigate zone 1?");
    expect(prompt).toContain("propose_task");
  });
});

// ─── Scenario 8: Alert severity pipeline ────────────

describe("E2E: Sensor alert → severity filter → notification", () => {
  it("critical moisture triggers alert", () => {
    const moisture = 12;
    const status = classifyMoistureStatus(moisture);
    expect(status).toBe("critical");

    expect(meetsAlertSeverity(status, "low")).toBe(true);
    expect(meetsAlertSeverity(status, "critical")).toBe(true);
  });

  it("normal moisture filtered at low threshold", () => {
    const status = classifyMoistureStatus(30);
    expect(status).toBe("normal");
    expect(meetsAlertSeverity(status, "low")).toBe(false);
  });
});
