import { describe, it, expect, vi } from "vitest";
import { ProposalManager, type DecisionRecord } from "./proposal-manager.js";
import type { TaskProposal } from "./types.js";

function makeProposal(overrides: Partial<TaskProposal> = {}): TaskProposal {
  return {
    taskId: `task-${Math.random().toString(36).slice(2, 10)}`,
    summary: "Start pump P1",
    reasoning: "Moisture below 20% in zone-1",
    targetRef: "actuator:pump:P1",
    operation: "start",
    peerDeviceId: "peer-abc",
    approvalLevel: "L2",
    status: "awaiting_approval",
    createdBy: "intelligence",
    triggerFrameIds: ["frame-1"],
    createdAt: Date.now(),
    ...overrides,
  };
}

// ─── Basic CRUD ─────────────────────────────────────

describe("ProposalManager - CRUD", () => {
  it("adds and retrieves a proposal", () => {
    const pm = new ProposalManager();
    const p = makeProposal({ taskId: "abc-123" });
    pm.add(p);
    expect(pm.get("abc-123")).toBe(p);
  });

  it("returns undefined for unknown ID", () => {
    const pm = new ProposalManager();
    expect(pm.get("nonexistent")).toBeUndefined();
  });

  it("tracks size", () => {
    const pm = new ProposalManager();
    expect(pm.size).toBe(0);
    pm.add(makeProposal());
    expect(pm.size).toBe(1);
    pm.add(makeProposal());
    expect(pm.size).toBe(2);
  });

  it("clears all proposals", () => {
    const pm = new ProposalManager();
    pm.add(makeProposal());
    pm.add(makeProposal());
    pm.clear();
    expect(pm.size).toBe(0);
  });

  it("getMap returns the internal map", () => {
    const pm = new ProposalManager();
    const p = makeProposal({ taskId: "x" });
    pm.add(p);
    const map = pm.getMap();
    expect(map.get("x")).toBe(p);
  });
});

// ─── Listing and filtering ──────────────────────────

describe("ProposalManager - list", () => {
  it("lists all proposals", () => {
    const pm = new ProposalManager();
    pm.add(makeProposal({ status: "awaiting_approval" }));
    pm.add(makeProposal({ status: "completed" }));
    expect(pm.list()).toHaveLength(2);
  });

  it("filters by status", () => {
    const pm = new ProposalManager();
    pm.add(makeProposal({ taskId: "a", status: "awaiting_approval" }));
    pm.add(makeProposal({ taskId: "b", status: "completed" }));
    pm.add(makeProposal({ taskId: "c", status: "awaiting_approval" }));
    expect(pm.list({ status: "awaiting_approval" })).toHaveLength(2);
    expect(pm.list({ status: "completed" })).toHaveLength(1);
    expect(pm.list({ status: "rejected" })).toHaveLength(0);
  });

  it("counts pending proposals", () => {
    const pm = new ProposalManager();
    pm.add(makeProposal({ taskId: "a", status: "proposed" }));
    pm.add(makeProposal({ taskId: "b", status: "awaiting_approval" }));
    pm.add(makeProposal({ taskId: "c", status: "completed" }));
    pm.add(makeProposal({ taskId: "d", status: "rejected" }));
    expect(pm.countPending()).toBe(2);
  });

  it("countPending returns 0 when empty", () => {
    expect(new ProposalManager().countPending()).toBe(0);
  });
});

// ─── findByPrefix ───────────────────────────────────

describe("ProposalManager - findByPrefix", () => {
  it("finds by full ID", () => {
    const pm = new ProposalManager();
    const p = makeProposal({ taskId: "abc-1234-5678" });
    pm.add(p);
    expect(pm.findByPrefix("abc-1234-5678")).toBe(p);
  });

  it("finds by prefix", () => {
    const pm = new ProposalManager();
    const p = makeProposal({ taskId: "abc-1234-5678" });
    pm.add(p);
    expect(pm.findByPrefix("abc")).toBe(p);
  });

  it("returns undefined for no match", () => {
    const pm = new ProposalManager();
    pm.add(makeProposal({ taskId: "abc-123" }));
    expect(pm.findByPrefix("xyz")).toBeUndefined();
  });
});

// ─── Approve ────────────────────────────────────────

describe("ProposalManager - approve", () => {
  it("approves an awaiting_approval proposal", () => {
    const pm = new ProposalManager();
    const p = makeProposal({ taskId: "t1", status: "awaiting_approval" });
    pm.add(p);
    const result = pm.approve("t1", "admin");
    expect(result).toBe(p);
    expect(p.status).toBe("approved");
    expect(p.resolvedBy).toBe("admin");
  });

  it("returns null for non-awaiting proposal", () => {
    const pm = new ProposalManager();
    pm.add(makeProposal({ taskId: "t1", status: "completed" }));
    expect(pm.approve("t1")).toBeNull();
  });

  it("returns null for unknown ID", () => {
    expect(new ProposalManager().approve("nonexistent")).toBeNull();
  });

  it("defaults approvedBy to operator", () => {
    const pm = new ProposalManager();
    const p = makeProposal({ taskId: "t1" });
    pm.add(p);
    pm.approve("t1");
    expect(p.resolvedBy).toBe("operator");
  });

  it("calls onDecision callback", () => {
    const decisions: DecisionRecord[] = [];
    const pm = new ProposalManager({ onDecision: (d) => decisions.push(d) });
    const p = makeProposal({ taskId: "t1", reasoning: "moisture low" });
    pm.add(p);
    pm.approve("t1");
    expect(decisions).toHaveLength(1);
    expect(decisions[0].approved).toBe(true);
    expect(decisions[0].triggerCondition).toBe("moisture low");
    expect(decisions[0].action.operation).toBe("start");
  });

  it("uses summary when reasoning is empty", () => {
    const decisions: DecisionRecord[] = [];
    const pm = new ProposalManager({ onDecision: (d) => decisions.push(d) });
    const p = makeProposal({ taskId: "t1", reasoning: "", summary: "Start pump" });
    pm.add(p);
    pm.approve("t1");
    expect(decisions[0].triggerCondition).toBe("Start pump");
  });

  it("includes triggerEventId from first frame ID", () => {
    const decisions: DecisionRecord[] = [];
    const pm = new ProposalManager({ onDecision: (d) => decisions.push(d) });
    const p = makeProposal({ taskId: "t1", triggerFrameIds: ["frame-abc"] });
    pm.add(p);
    pm.approve("t1");
    expect(decisions[0].triggerEventId).toBe("frame-abc");
  });
});

// ─── Reject ─────────────────────────────────────────

describe("ProposalManager - reject", () => {
  it("rejects an awaiting_approval proposal", () => {
    const pm = new ProposalManager();
    const p = makeProposal({ taskId: "t1" });
    pm.add(p);
    const result = pm.reject("t1", "admin");
    expect(result).toBe(p);
    expect(p.status).toBe("rejected");
    expect(p.resolvedBy).toBe("admin");
    expect(p.resolvedAt).toBeGreaterThan(0);
  });

  it("returns null for non-awaiting proposal", () => {
    const pm = new ProposalManager();
    pm.add(makeProposal({ taskId: "t1", status: "approved" }));
    expect(pm.reject("t1")).toBeNull();
  });

  it("calls onDecision with approved=false", () => {
    const decisions: DecisionRecord[] = [];
    const pm = new ProposalManager({ onDecision: (d) => decisions.push(d) });
    pm.add(makeProposal({ taskId: "t1" }));
    pm.reject("t1");
    expect(decisions).toHaveLength(1);
    expect(decisions[0].approved).toBe(false);
  });

  it("calls onResolved callback", () => {
    const resolved: TaskProposal[] = [];
    const pm = new ProposalManager({ onResolved: (p) => resolved.push(p) });
    const p = makeProposal({ taskId: "t1" });
    pm.add(p);
    pm.reject("t1");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toBe(p);
  });
});

// ─── Complete ───────────────────────────────────────

describe("ProposalManager - complete", () => {
  it("marks as completed on success", () => {
    const pm = new ProposalManager();
    const p = makeProposal({ taskId: "t1", status: "executing" });
    pm.add(p);
    const result = pm.complete("t1", { ok: true, payload: { started: true } });
    expect(result).toBe(p);
    expect(p.status).toBe("completed");
    expect(p.result).toEqual({ ok: true, payload: { started: true } });
    expect(p.resolvedAt).toBeGreaterThan(0);
  });

  it("marks as failed on error", () => {
    const pm = new ProposalManager();
    const p = makeProposal({ taskId: "t1", status: "executing" });
    pm.add(p);
    pm.complete("t1", { ok: false, error: "timeout" });
    expect(p.status).toBe("failed");
    expect(p.result?.error).toBe("timeout");
  });

  it("returns null for unknown ID", () => {
    expect(new ProposalManager().complete("x", { ok: true })).toBeNull();
  });

  it("calls onResolved callback", () => {
    const resolved = vi.fn();
    const pm = new ProposalManager({ onResolved: resolved });
    pm.add(makeProposal({ taskId: "t1" }));
    pm.complete("t1", { ok: true });
    expect(resolved).toHaveBeenCalledTimes(1);
  });
});

// ─── Edge cases ─────────────────────────────────────

describe("ProposalManager - edge cases", () => {
  it("overwrites proposal with same ID", () => {
    const pm = new ProposalManager();
    const p1 = makeProposal({ taskId: "same", summary: "first" });
    const p2 = makeProposal({ taskId: "same", summary: "second" });
    pm.add(p1);
    pm.add(p2);
    expect(pm.get("same")?.summary).toBe("second");
    expect(pm.size).toBe(1);
  });

  it("approve does not call onResolved (only reject/complete do)", () => {
    const resolved = vi.fn();
    const pm = new ProposalManager({ onResolved: resolved });
    pm.add(makeProposal({ taskId: "t1" }));
    pm.approve("t1");
    expect(resolved).not.toHaveBeenCalled();
  });

  it("cannot approve twice", () => {
    const pm = new ProposalManager();
    const p = makeProposal({ taskId: "t1" });
    pm.add(p);
    expect(pm.approve("t1")).toBe(p);
    expect(pm.approve("t1")).toBeNull(); // already approved
  });

  it("cannot reject after approval", () => {
    const pm = new ProposalManager();
    pm.add(makeProposal({ taskId: "t1" }));
    pm.approve("t1");
    expect(pm.reject("t1")).toBeNull();
  });
});
