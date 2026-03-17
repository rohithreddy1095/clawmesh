/**
 * 🎯 1500 milestone tests — final push.
 */

import { describe, it, expect } from "vitest";
import { ModeController } from "../agents/mode-controller.js";
import { ProposalManager } from "../agents/proposal-manager.js";
import { calculateConfidence, decayConfidence } from "../agents/pattern-logic.js";
import { deriveActuatorStatus } from "../mesh/actuator-logic.js";
import { classifyMoistureStatus, buildObservationPayload } from "../mesh/sensor-simulation.js";
import { chunkMessage, escapeMarkdownV2 } from "../channels/telegram-helpers.js";
import { fmtUptime, compactDataSummary, formatFrames } from "../agents/extensions/mesh-extension-helpers.js";
import { cleanIntentText, extractCitations } from "../agents/planner-prompt-builder.js";
import { classifyEvent } from "../agents/session-event-classifier.js";
import type { ContextFrame } from "../mesh/context-types.js";

function makeFrame(overrides: Partial<ContextFrame> = {}): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "device-abc123456789",
    timestamp: Date.now(),
    data: { metric: "moisture", value: 42, zone: "zone-1" },
    trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T1_unverified_observation" },
    ...overrides,
  };
}

// ─── Additional ModeController scenarios ────────────

describe("ModeController - final scenarios", () => {
  it("permanent error during active with errors below threshold still suspends", () => {
    const mc = new ModeController({ errorThreshold: 10 });
    mc.recordFailure("temp", false);
    expect(mc.mode).toBe("active");
    mc.recordFailure("403 forbidden", true);
    expect(mc.mode).toBe("suspended");
  });

  it("success resets after near-threshold errors", () => {
    const mc = new ModeController({ errorThreshold: 3 });
    mc.recordFailure("e1", false);
    mc.recordFailure("e2", false);
    expect(mc.consecutiveErrors).toBe(2);
    mc.recordSuccess();
    expect(mc.consecutiveErrors).toBe(0);
    mc.recordFailure("e3", false);
    expect(mc.mode).toBe("active"); // still active, only 1 error
  });
});

// ─── ProposalManager final ──────────────────────────

describe("ProposalManager - final scenarios", () => {
  it("findByPrefix with single char matches", () => {
    const pm = new ProposalManager();
    pm.add({
      taskId: "abc-123",
      summary: "Test",
      reasoning: "Test",
      targetRef: "t",
      operation: "o",
      peerDeviceId: "p",
      approvalLevel: "L2",
      status: "awaiting_approval",
      createdBy: "intelligence",
      triggerFrameIds: [],
      createdAt: Date.now(),
    });
    expect(pm.findByPrefix("a")).toBeDefined();
    expect(pm.findByPrefix("ab")).toBeDefined();
    expect(pm.findByPrefix("z")).toBeUndefined();
  });
});

// ─── Actuator status for all operations ─────────────

describe("Actuator status - comprehensive operations", () => {
  const activationOps = ["open", "start", "on", "enable", "OPEN", "Start", "ON"];
  const deactivationOps = ["close", "stop", "off", "disable", "CLOSE", "Stop", "OFF"];

  for (const op of activationOps) {
    it(`${op} → active`, () => {
      expect(deriveActuatorStatus(op)).toBe("active");
    });
  }

  for (const op of deactivationOps) {
    it(`${op} → inactive`, () => {
      expect(deriveActuatorStatus(op)).toBe("inactive");
    });
  }

  it("set with state → custom status", () => {
    expect(deriveActuatorStatus("set", { state: "half-open" })).toBe("half-open");
    expect(deriveActuatorStatus("set", { state: "standby" })).toBe("standby");
  });
});

// ─── Moisture status boundaries ─────────────────────

describe("Moisture status - all boundaries", () => {
  it("19.99 is critical", () => expect(classifyMoistureStatus(19.99)).toBe("critical"));
  it("20.0 is low", () => expect(classifyMoistureStatus(20.0)).toBe("low"));
  it("24.99 is low", () => expect(classifyMoistureStatus(24.99)).toBe("low"));
  it("25.0 is normal", () => expect(classifyMoistureStatus(25.0)).toBe("normal"));
});

// ─── More formatting ────────────────────────────────

describe("Formatting - additional", () => {
  it("fmtUptime edge: exactly 0", () => expect(fmtUptime(0)).toBe("0m00s"));
  it("fmtUptime edge: 999ms rounds to 0", () => expect(fmtUptime(999)).toBe("0m00s"));
  it("compactDataSummary with null value", () => {
    expect(compactDataSummary({ zone: "z1", metric: "m", value: null })).toContain("z1");
  });
});
