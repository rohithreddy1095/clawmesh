/**
 * Data flow validation tests — verify that data transformations
 * are correct as data flows through the architecture pipeline.
 */

import { describe, it, expect } from "vitest";
import { checkThresholdBreach, isPermanentLLMError } from "../agents/threshold-checker.js";
import { mergeSourceCounters, aggregateSourceCounters } from "../agents/pattern-memory.js";
import { ModeController } from "../agents/mode-controller.js";
import { ingestFrame } from "../agents/frame-ingestor.js";
import { extractCitations } from "../agents/planner-prompt-builder.js";
import { classifyEvent, extractAssistantText, extractToolCallNames } from "../agents/session-event-classifier.js";
import { calculateConfidence, decayConfidence, patternKey } from "../agents/pattern-logic.js";
import { deriveActuatorStatus, parseTargetRef, isActuatorRef, isSensorRef } from "../mesh/actuator-logic.js";
import { simulateMoistureStep, classifyMoistureStatus, buildObservationPayload } from "../mesh/sensor-simulation.js";
import { escapeMarkdownV2, meetsAlertSeverity, formatAlertMessage } from "../channels/telegram-helpers.js";
import { buildDefaultCapabilities, expandShorthandFlags } from "../cli/cli-config.js";
import type { ContextFrame } from "../mesh/context-types.js";

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

// ─── CRDT merge correctness ─────────────────────────

describe("CRDT merge - data correctness", () => {
  it("merge is commutative (A+B == B+A)", () => {
    const a = { node1: { approvals: 3, rejections: 1 } };
    const b = { node2: { approvals: 2, rejections: 0 } };
    const ab = mergeSourceCounters(a, b);
    const ba = mergeSourceCounters(b, a);
    expect(ab).toEqual(ba);
  });

  it("merge is idempotent (A+A == A)", () => {
    const a = { node1: { approvals: 5, rejections: 2 } };
    const merged = mergeSourceCounters(a, a);
    expect(merged).toEqual(a);
  });

  it("merge takes max per source", () => {
    const local = { node1: { approvals: 3, rejections: 1 } };
    const remote = { node1: { approvals: 5, rejections: 0 } };
    const merged = mergeSourceCounters(local, remote);
    expect(merged.node1.approvals).toBe(5);
    expect(merged.node1.rejections).toBe(1);
  });

  it("aggregate sums all sources", () => {
    const counters = {
      node1: { approvals: 3, rejections: 1 },
      node2: { approvals: 2, rejections: 0 },
      node3: { approvals: 1, rejections: 1 },
    };
    const { approvals, rejections } = aggregateSourceCounters(counters);
    expect(approvals).toBe(6);
    expect(rejections).toBe(2);
  });

  it("aggregate of empty is zero", () => {
    const { approvals, rejections } = aggregateSourceCounters({});
    expect(approvals).toBe(0);
    expect(rejections).toBe(0);
  });
});

// ─── Threshold checker correctness ──────────────────

describe("Threshold checker - data flow", () => {
  it("correctly identifies below threshold breach", () => {
    const rule = { ruleId: "r1", metric: "moisture", belowThreshold: 20, promptHint: "low", cooldownMs: 0 };
    const frame = makeFrame({ data: { metric: "moisture", value: 15 } });
    expect(checkThresholdBreach(rule, frame, 0, Date.now())).toBe(true);
  });

  it("correctly identifies above threshold breach", () => {
    const rule = { ruleId: "r1", metric: "temp", aboveThreshold: 40, promptHint: "hot", cooldownMs: 0 };
    const frame = makeFrame({ data: { metric: "temp", value: 45 } });
    expect(checkThresholdBreach(rule, frame, 0, Date.now())).toBe(true);
  });

  it("within-range values do not breach", () => {
    const rule = { ruleId: "r1", metric: "moisture", belowThreshold: 20, aboveThreshold: 80, promptHint: "ok", cooldownMs: 0 };
    const frame = makeFrame({ data: { metric: "moisture", value: 50 } });
    expect(checkThresholdBreach(rule, frame, 0, Date.now())).toBe(false);
  });
});

// ─── Permanent error detection ──────────────────────

describe("isPermanentLLMError - comprehensive", () => {
  it("detects 403", () => expect(isPermanentLLMError("Error: 403 Forbidden")).toBe(true));
  it("detects 401", () => expect(isPermanentLLMError("401 Unauthorized")).toBe(true));
  it("detects disabled", () => expect(isPermanentLLMError("Account disabled")).toBe(true));
  it("detects terms of service", () => expect(isPermanentLLMError("Terms of service violation")).toBe(true));
  it("normal timeout is not permanent", () => expect(isPermanentLLMError("ETIMEDOUT")).toBe(false));
  it("rate limit is not permanent", () => expect(isPermanentLLMError("429 Too Many Requests")).toBe(false));
  it("network error is not permanent", () => expect(isPermanentLLMError("ECONNRESET")).toBe(false));
});

// ─── Target ref classification ──────────────────────

describe("Target ref classification - data flow", () => {
  it("correctly classifies all target types", () => {
    expect(isActuatorRef("actuator:pump:P1")).toBe(true);
    expect(isActuatorRef("sensor:moisture")).toBe(false);
    expect(isSensorRef("sensor:moisture:zone-1")).toBe(true);
    expect(isSensorRef("actuator:pump:P1")).toBe(false);
  });

  it("parses complex refs correctly", () => {
    const ref = parseTargetRef("actuator:valve:zone-1:V3");
    expect(ref.type).toBe("actuator");
    expect(ref.subtype).toBe("valve");
    expect(ref.identifier).toBe("zone-1:V3");
  });
});

// ─── Sensor → status pipeline ───────────────────────

describe("Sensor reading → status → alert pipeline", () => {
  it("moisture reading flows to correct alert", () => {
    // Step 1: Simulate reading
    const value = simulateMoistureStep(30, 18, 0); // Force to 12%
    expect(value).toBe(12);

    // Step 2: Classify
    const status = classifyMoistureStatus(value);
    expect(status).toBe("critical");

    // Step 3: Build payload
    const payload = buildObservationPayload({
      zone: "zone-1", metric: "moisture", value, unit: "%",
    });
    expect(payload.status).toBe("critical");

    // Step 4: Check alert threshold
    expect(meetsAlertSeverity(payload.status, "low")).toBe(true);

    // Step 5: Format alert
    const frame = makeFrame({ data: payload, sourceDisplayName: "Sensor A" });
    const alert = formatAlertMessage(frame);
    expect(alert).toContain("🚨");
    expect(alert).toContain("zone-1");
    expect(alert).toContain("12");
  });
});

// ─── Pattern confidence lifecycle ───────────────────

describe("Pattern confidence lifecycle", () => {
  it("confidence grows then decays over time", () => {
    // Start with approvals
    let confidence = calculateConfidence(5, 1); // ~83%
    expect(confidence).toBeCloseTo(0.833, 2);

    // After 2 weeks without updates
    const twoWeeksMs = 14 * 24 * 3600_000;
    const decayed = decayConfidence(confidence, Date.now() - twoWeeksMs, Date.now(), 7 * 24 * 3600_000, 0.9);
    expect(decayed).toBeLessThan(confidence);
    expect(decayed).toBeGreaterThan(0);

    // After many months
    const sixMonthsMs = 180 * 24 * 3600_000;
    const veryDecayed = decayConfidence(confidence, Date.now() - sixMonthsMs, Date.now(), 7 * 24 * 3600_000, 0.9);
    expect(veryDecayed).toBeLessThan(0.1);
  });
});

// ─── CLI config → capabilities pipeline ─────────────

describe("CLI config → capability pipeline", () => {
  it("field-node flags produce correct capabilities", () => {
    const opts = expandShorthandFlags({ fieldNode: true });
    const caps = buildDefaultCapabilities({
      mockActuator: opts.mockActuator,
      mockSensor: opts.mockSensor,
      capabilities: ["custom:farm"],
    });
    expect(caps).toContain("channel:clawmesh");
    expect(caps).toContain("actuator:mock");
    expect(caps).toContain("sensor:mock");
    expect(caps).toContain("custom:farm");
  });
});
