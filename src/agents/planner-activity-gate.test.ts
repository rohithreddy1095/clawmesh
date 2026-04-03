import { describe, expect, it } from "vitest";
import {
  shouldProcessPlannerTrigger,
  shouldWakePlannerOnActivityChange,
} from "./planner-activity-gate.js";
import type { PlannerActivity } from "../mesh/planner-election.js";

function activity(overrides?: Partial<PlannerActivity>): PlannerActivity {
  return {
    state: "active",
    role: "planner",
    shouldHandleAutonomous: true,
    leader: { kind: "local", deviceId: "local-device", role: "planner" },
    ...overrides,
  };
}

describe("planner activity gate", () => {
  it("allows operator intents even when planner is standby", () => {
    expect(shouldProcessPlannerTrigger(activity({
      state: "standby",
      role: "standby-planner",
      shouldHandleAutonomous: false,
      leader: { kind: "peer", deviceId: "peer-planner", role: "planner" },
    }), "operator_intent")).toBe(true);
  });

  it("blocks autonomous triggers when planner is standby", () => {
    const standby = activity({
      state: "standby",
      role: "standby-planner",
      shouldHandleAutonomous: false,
      leader: { kind: "peer", deviceId: "peer-planner", role: "planner" },
    });
    expect(shouldProcessPlannerTrigger(standby, "threshold_breach")).toBe(false);
    expect(shouldProcessPlannerTrigger(standby, "proactive_check")).toBe(false);
  });

  it("wakes queued autonomous work when planner becomes active", () => {
    const prev = activity({
      state: "standby",
      role: "standby-planner",
      shouldHandleAutonomous: false,
      leader: { kind: "peer", deviceId: "peer-planner", role: "planner" },
    });
    const next = activity({
      state: "active",
      role: "standby-planner",
      shouldHandleAutonomous: true,
      leader: { kind: "local", deviceId: "local-device", role: "standby-planner" },
    });
    expect(shouldWakePlannerOnActivityChange(prev, next, "threshold_breach")).toBe(true);
  });

  it("does not wake when next queued trigger is an operator intent", () => {
    const prev = activity({
      state: "standby",
      role: "standby-planner",
      shouldHandleAutonomous: false,
      leader: { kind: "peer", deviceId: "peer-planner", role: "planner" },
    });
    const next = activity({
      state: "active",
      role: "standby-planner",
      shouldHandleAutonomous: true,
      leader: { kind: "local", deviceId: "local-device", role: "standby-planner" },
    });
    expect(shouldWakePlannerOnActivityChange(prev, next, "operator_intent")).toBe(false);
  });

  it("does not wake if planner was already active", () => {
    const prev = activity();
    const next = activity();
    expect(shouldWakePlannerOnActivityChange(prev, next, "threshold_breach")).toBe(false);
  });
});
