import { describe, expect, it } from "vitest";
import { partitionSystemTriggersForOperatorTurn, shouldEnqueueProactiveCheck } from "./operator-priority.js";
import type { TriggerEntry } from "./trigger-queue.js";

function trigger(overrides: Partial<TriggerEntry>): TriggerEntry {
  return {
    reason: overrides.reason ?? "test",
    frames: overrides.frames ?? [],
    conversationId: overrides.conversationId,
    requestId: overrides.requestId,
    type: overrides.type ?? "proactive_check",
    priority: overrides.priority ?? 3,
    enqueuedAt: overrides.enqueuedAt ?? Date.now(),
    dedupKey: overrides.dedupKey,
  };
}

describe("shouldEnqueueProactiveCheck", () => {
  it("allows proactive checks only when planner is idle and queue is empty", () => {
    expect(shouldEnqueueProactiveCheck({
      running: false,
      pendingTriggerCount: 0,
      hasPendingOperatorIntent: false,
    })).toBe(true);
  });

  it("blocks proactive checks while planner is running", () => {
    expect(shouldEnqueueProactiveCheck({
      running: true,
      pendingTriggerCount: 0,
      hasPendingOperatorIntent: false,
    })).toBe(false);
  });

  it("blocks proactive checks when any trigger is already queued", () => {
    expect(shouldEnqueueProactiveCheck({
      running: false,
      pendingTriggerCount: 2,
      hasPendingOperatorIntent: false,
    })).toBe(false);
  });

  it("blocks proactive checks when operator work is waiting", () => {
    expect(shouldEnqueueProactiveCheck({
      running: false,
      pendingTriggerCount: 1,
      hasPendingOperatorIntent: true,
    })).toBe(false);
  });
});

describe("partitionSystemTriggersForOperatorTurn", () => {
  it("defers proactive checks behind operator turns", () => {
    const proactive = trigger({ type: "proactive_check", priority: 3, dedupKey: "proactive" });
    const threshold = trigger({ type: "threshold_breach", priority: 1, reason: "threshold" });

    const result = partitionSystemTriggersForOperatorTurn([threshold, proactive]);

    expect(result.immediateSystemTriggers).toEqual([threshold]);
    expect(result.deferredSystemTriggers).toEqual([proactive]);
  });

  it("leaves threshold/system triggers in the operator turn", () => {
    const thresholdA = trigger({ type: "threshold_breach", priority: 1, reason: "threshold-a" });
    const thresholdB = trigger({ type: "threshold_breach", priority: 1, reason: "threshold-b" });

    const result = partitionSystemTriggersForOperatorTurn([thresholdA, thresholdB]);

    expect(result.immediateSystemTriggers).toEqual([thresholdA, thresholdB]);
    expect(result.deferredSystemTriggers).toEqual([]);
  });
});
