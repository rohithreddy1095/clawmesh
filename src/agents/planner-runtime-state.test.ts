import { describe, expect, it } from "vitest";
import { PlannerRuntimeState, describeTriggerReason } from "./planner-runtime-state.js";

describe("PlannerRuntimeState", () => {
  it("tracks queue depth and queued stage", () => {
    const state = new PlannerRuntimeState();

    state.updateQueue({ total: 2, operatorIntent: 1, thresholdBreach: 1, proactiveCheck: 0 });
    state.noteQueuedIntent("hello there");

    expect(state.getSnapshot()).toMatchObject({
      stage: "queued",
      queueDepth: 2,
      queue: {
        operatorIntent: 1,
        thresholdBreach: 1,
        proactiveCheck: 0,
      },
      lastIntent: "hello there",
    });
  });

  it("tracks active cycle and tool execution", () => {
    const state = new PlannerRuntimeState();

    state.updateQueue({ total: 1, operatorIntent: 1, thresholdBreach: 0, proactiveCheck: 0 });
    state.startCycle({
      type: "operator_intent",
      reason: 'operator_intent: "check zone-1"',
      frames: [],
      conversationId: "conv-1",
      requestId: "req-1",
      priority: 0,
      enqueuedAt: 1,
    });
    state.markToolStart("query_world_model");

    expect(state.getSnapshot()).toMatchObject({
      running: true,
      stage: "tool",
      activeTriggerType: "operator_intent",
      activeConversationId: "conv-1",
      activeRequestId: "req-1",
      activeToolName: "query_world_model",
      lastToolName: "query_world_model",
      lastIntent: "check zone-1",
    });
  });

  it("records errors and returns to idle after completion", () => {
    const state = new PlannerRuntimeState();

    state.updateQueue({ total: 1, operatorIntent: 0, thresholdBreach: 1, proactiveCheck: 0 });
    state.startCycle({
      type: "threshold_breach",
      reason: "threshold_breach: moisture_low — Soil is dry",
      frames: [],
      priority: 1,
      enqueuedAt: 1,
    });
    state.markError("prompt failed: boom");

    expect(state.getSnapshot().stage).toBe("error");
    expect(state.getSnapshot().lastError).toContain("boom");

    state.updateQueue({ total: 0, operatorIntent: 0, thresholdBreach: 0, proactiveCheck: 0 });
    state.finishCycle();
    expect(state.getSnapshot().stage).toBe("idle");
  });

  it("uses observing and suspended as first-class stages", () => {
    const state = new PlannerRuntimeState();

    state.updateMode("observing");
    expect(state.getSnapshot().stage).toBe("observing");

    state.updateMode("suspended");
    expect(state.getSnapshot().stage).toBe("suspended");
  });
});

describe("describeTriggerReason", () => {
  it("strips queue prefixes for operator and threshold triggers", () => {
    expect(describeTriggerReason({ type: "operator_intent", reason: 'operator_intent: "hello"' } as any)).toBe("hello");
    expect(describeTriggerReason({ type: "threshold_breach", reason: "threshold_breach: moisture_low — Soil is dry" } as any)).toBe("moisture_low — Soil is dry");
  });
});
