import { describe, expect, it } from "vitest";
import { choosePlannerLeader, getPlannerActivity, isPlannerEligible } from "./planner-election.js";
import type { MeshNodeRole } from "./types.js";

function candidate(deviceId: string, role: MeshNodeRole) {
  return { deviceId, role };
}

describe("planner election", () => {
  it("treats planner as eligible", () => {
    expect(isPlannerEligible("planner")).toBe(true);
  });

  it("treats standby-planner as eligible", () => {
    expect(isPlannerEligible("standby-planner")).toBe(true);
  });

  it("treats viewer as ineligible", () => {
    expect(isPlannerEligible("viewer")).toBe(false);
  });

  it("returns none when no planner-capable nodes exist", () => {
    const leader = choosePlannerLeader({
      self: candidate("self-1", "field"),
      peers: [candidate("peer-1", "viewer")],
    });
    expect(leader.kind).toBe("none");
  });

  it("prefers planner over standby-planner", () => {
    const leader = choosePlannerLeader({
      self: candidate("self-1", "standby-planner"),
      peers: [candidate("peer-1", "planner")],
    });
    expect(leader).toEqual({ kind: "peer", deviceId: "peer-1", role: "planner" });
  });

  it("elects local node when it wins deterministic tie-break", () => {
    const leader = choosePlannerLeader({
      self: candidate("aaa-self", "planner"),
      peers: [candidate("zzz-peer", "planner")],
    });
    expect(leader).toEqual({ kind: "local", deviceId: "aaa-self", role: "planner" });
  });

  it("elects peer when peer wins deterministic tie-break", () => {
    const leader = choosePlannerLeader({
      self: candidate("zzz-self", "planner"),
      peers: [candidate("aaa-peer", "planner")],
    });
    expect(leader).toEqual({ kind: "peer", deviceId: "aaa-peer", role: "planner" });
  });

  it("marks local planner leader as active", () => {
    const activity = getPlannerActivity({
      self: candidate("aaa-self", "planner"),
      peers: [candidate("zzz-peer", "standby-planner")],
    });
    expect(activity.state).toBe("active");
    expect(activity.shouldHandleAutonomous).toBe(true);
    expect(activity.leader).toEqual({ kind: "local", deviceId: "aaa-self", role: "planner" });
  });

  it("marks lower-priority local planner as standby", () => {
    const activity = getPlannerActivity({
      self: candidate("zzz-self", "standby-planner"),
      peers: [candidate("aaa-peer", "planner")],
    });
    expect(activity.state).toBe("standby");
    expect(activity.shouldHandleAutonomous).toBe(false);
    expect(activity.leader).toEqual({ kind: "peer", deviceId: "aaa-peer", role: "planner" });
  });

  it("marks non-planner roles as ineligible", () => {
    const activity = getPlannerActivity({
      self: candidate("node-1", "field"),
      peers: [candidate("planner-1", "planner")],
    });
    expect(activity.state).toBe("ineligible");
    expect(activity.shouldHandleAutonomous).toBe(false);
  });
});
