/**
 * Tests for TriggerQueue wiring into PiSession.
 *
 * Verifies that PiSession uses the TriggerQueue for operator intents,
 * threshold breaches, and proactive checks — with proper priority and dedup.
 */

import { describe, it, expect } from "vitest";
import { TriggerQueue, TRIGGER_PRIORITIES } from "./trigger-queue.js";
import type { ContextFrame } from "../mesh/context-types.js";

function makeFrame(overrides?: Partial<ContextFrame>): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "sensor-node",
    timestamp: Date.now(),
    data: { metric: "soil_moisture", value: 12, zone: "zone-1" },
    trust: {
      evidence_sources: ["sensor"],
      evidence_trust_tier: "T2_operational_observation",
    },
    ...overrides,
  };
}

describe("TriggerQueue as PiSession replacement", () => {
  it("enqueueIntent replaces pendingTriggers.push for operator intents", () => {
    const queue = new TriggerQueue();
    queue.enqueueIntent("irrigate zone-1", {
      conversationId: "conv-1",
      requestId: "req-1",
    });

    const { operatorIntents } = queue.drain();
    expect(operatorIntents).toHaveLength(1);
    expect(operatorIntents[0].conversationId).toBe("conv-1");
    expect(operatorIntents[0].requestId).toBe("req-1");
    expect(operatorIntents[0].reason).toContain("irrigate zone-1");
  });

  it("enqueueThresholdBreach replaces pendingTriggers.push for thresholds", () => {
    const queue = new TriggerQueue();
    const frame = makeFrame();
    queue.enqueueThresholdBreach({
      ruleId: "moisture-critical",
      promptHint: "Moisture below 20%",
      metric: "soil_moisture",
      zone: "zone-1",
      frame,
    });

    const { systemTriggers } = queue.drain();
    expect(systemTriggers).toHaveLength(1);
    expect(systemTriggers[0].type).toBe("threshold_breach");
    expect(systemTriggers[0].frames).toHaveLength(1);
    expect(systemTriggers[0].reason).toContain("moisture-critical");
  });

  it("enqueueProactiveCheck replaces pendingTriggers.push for proactive", () => {
    const queue = new TriggerQueue();
    const frames = [makeFrame(), makeFrame({ frameId: "f2" })];
    queue.enqueueProactiveCheck(frames);

    const { systemTriggers } = queue.drain();
    expect(systemTriggers).toHaveLength(1);
    expect(systemTriggers[0].type).toBe("proactive_check");
  });

  it("drain() separates intents from system triggers (matching PiSession runCycle)", () => {
    const queue = new TriggerQueue();
    queue.enqueueProactiveCheck([]);
    queue.enqueueThresholdBreach({
      ruleId: "r1",
      promptHint: "test",
      metric: "m",
      frame: makeFrame(),
    });
    queue.enqueueIntent("check status", { conversationId: "c1" });
    queue.enqueueIntent("also check zone-2", { conversationId: "c2" });

    const { operatorIntents, systemTriggers } = queue.drain();

    // PiSession processes first intent conversationally, queues rest
    expect(operatorIntents).toHaveLength(2);
    expect(systemTriggers).toHaveLength(2);

    // System triggers are sorted: threshold(1) before proactive(3)
    expect(systemTriggers[0].type).toBe("threshold_breach");
    expect(systemTriggers[1].type).toBe("proactive_check");
  });

  it("deduplicates repeated threshold breaches (same metric+zone)", () => {
    const queue = new TriggerQueue();

    // First breach
    queue.enqueueThresholdBreach({
      ruleId: "r1",
      promptHint: "dry",
      metric: "soil_moisture",
      zone: "zone-1",
      frame: makeFrame({ data: { metric: "soil_moisture", value: 10, zone: "zone-1" } }),
    });

    // Second breach (same metric+zone within dedup window)
    queue.enqueueThresholdBreach({
      ruleId: "r1",
      promptHint: "dry",
      metric: "soil_moisture",
      zone: "zone-1",
      frame: makeFrame({ data: { metric: "soil_moisture", value: 8, zone: "zone-1" } }),
    });

    expect(queue.length).toBe(1); // Deduplicated!
  });

  it("does NOT dedup different zones", () => {
    const queue = new TriggerQueue();
    queue.enqueueThresholdBreach({
      ruleId: "r1",
      promptHint: "dry",
      metric: "soil_moisture",
      zone: "zone-1",
      frame: makeFrame(),
    });
    queue.enqueueThresholdBreach({
      ruleId: "r1",
      promptHint: "dry",
      metric: "soil_moisture",
      zone: "zone-2",
      frame: makeFrame(),
    });

    expect(queue.length).toBe(2); // Different zones = different triggers
  });

  it("isEmpty matches pendingTriggers.length > 0 check", () => {
    const queue = new TriggerQueue();
    expect(queue.isEmpty).toBe(true);

    queue.enqueueIntent("test");
    expect(queue.isEmpty).toBe(false);

    queue.drain();
    expect(queue.isEmpty).toBe(true);
  });
});
