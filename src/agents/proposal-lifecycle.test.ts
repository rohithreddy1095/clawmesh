/**
 * Tests for proposal lifecycle safety — expiry and dedup.
 *
 * These test real production scenarios:
 * - Operator walks away → proposal expires safely
 * - Two planners both propose irrigation → dedup catches it
 * - Conditions change → dedup resets correctly
 */

import { describe, it, expect } from "vitest";
import { ProposalManager } from "./proposal-manager.js";
import { ProposalDedup } from "./proposal-dedup.js";
import type { TaskProposal } from "./types.js";

function makeProposal(overrides?: Partial<TaskProposal>): TaskProposal {
  return {
    taskId: `task-${Math.random().toString(36).slice(2, 10)}`,
    summary: "Irrigate zone-1",
    reasoning: "Soil moisture at 12%",
    operation: "irrigate",
    targetRef: "actuator:pump:P1",
    peerDeviceId: "peer-01",
    approvalLevel: "L2",
    status: "awaiting_approval",
    createdBy: "intelligence",
    createdAt: Date.now(),
    triggerFrameIds: [],
    ...overrides,
  } as TaskProposal;
}

// ── Proposal Expiry ───────────────────────────────────

describe("ProposalManager expiry", () => {
  it("fresh proposal is not expired", () => {
    const pm = new ProposalManager();
    const p = makeProposal({ createdAt: Date.now() });
    pm.add(p);
    expect(pm.isExpired(p.taskId)).toBe(false);
  });

  it("old proposal is expired after default 30min", () => {
    const pm = new ProposalManager();
    const now = Date.now();
    const p = makeProposal({ createdAt: now - 31 * 60_000 });
    pm.add(p);
    expect(pm.isExpired(p.taskId, now)).toBe(true);
  });

  it("custom expiresAtMs overrides default", () => {
    const pm = new ProposalManager();
    const now = Date.now();
    const p = makeProposal({
      createdAt: now - 5000,
      expiresAtMs: now - 1000, // Expired 1 second ago
    });
    pm.add(p);
    expect(pm.isExpired(p.taskId, now)).toBe(true);
  });

  it("completed/rejected proposals are never considered expired", () => {
    const pm = new ProposalManager();
    const now = Date.now();
    const p = makeProposal({
      createdAt: now - 60 * 60_000, // 1 hour ago
      status: "completed",
    });
    pm.add(p);
    expect(pm.isExpired(p.taskId, now)).toBe(false);
  });

  it("sweepExpired transitions expired proposals to rejected", () => {
    const resolved: TaskProposal[] = [];
    const pm = new ProposalManager({
      onResolved: (p) => resolved.push(p),
    });

    const now = Date.now();
    pm.add(makeProposal({ taskId: "fresh", createdAt: now }));
    pm.add(makeProposal({ taskId: "old-1", createdAt: now - 31 * 60_000 }));
    pm.add(makeProposal({ taskId: "old-2", createdAt: now - 45 * 60_000 }));
    pm.add(makeProposal({ taskId: "completed", createdAt: now - 60 * 60_000, status: "completed" }));

    const expired = pm.sweepExpired(now);
    expect(expired).toContain("old-1");
    expect(expired).toContain("old-2");
    expect(expired).not.toContain("fresh");
    expect(expired).not.toContain("completed");
    expect(resolved).toHaveLength(2);

    // Verify expired proposals are rejected
    expect(pm.get("old-1")!.status).toBe("rejected");
    expect(pm.get("old-1")!.resolvedBy).toBe("system:expired");
  });

  it("approve on expired proposal fails", () => {
    const pm = new ProposalManager();
    const now = Date.now();
    const p = makeProposal({ createdAt: now - 31 * 60_000 });
    pm.add(p);
    pm.sweepExpired(now); // Expire it first
    expect(pm.approve(p.taskId)).toBeNull(); // Can't approve rejected proposal
  });

  it("sweepExpired is idempotent", () => {
    const pm = new ProposalManager();
    const now = Date.now();
    pm.add(makeProposal({ taskId: "old", createdAt: now - 60 * 60_000 }));

    const first = pm.sweepExpired(now);
    const second = pm.sweepExpired(now);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0); // Already expired
  });
});

// ── Proposal Dedup ────────────────────────────────────

describe("ProposalDedup", () => {
  it("first proposal for an action is allowed", () => {
    const dd = new ProposalDedup();
    expect(dd.checkAndRecord({
      targetRef: "actuator:pump:P1",
      operation: "irrigate",
      zone: "zone-1",
    })).toBe(true);
  });

  it("second identical proposal within window is blocked", () => {
    const dd = new ProposalDedup({ windowMs: 60_000 });
    const sig = { targetRef: "actuator:pump:P1", operation: "irrigate", zone: "zone-1" };
    dd.checkAndRecord(sig);
    expect(dd.checkAndRecord(sig)).toBe(false);
  });

  it("same action different zone is allowed", () => {
    const dd = new ProposalDedup();
    dd.checkAndRecord({ targetRef: "actuator:pump:P1", operation: "irrigate", zone: "zone-1" });
    expect(dd.checkAndRecord({
      targetRef: "actuator:pump:P1", operation: "irrigate", zone: "zone-2",
    })).toBe(true);
  });

  it("same zone different operation is allowed", () => {
    const dd = new ProposalDedup();
    dd.checkAndRecord({ targetRef: "actuator:pump:P1", operation: "start", zone: "zone-1" });
    expect(dd.checkAndRecord({
      targetRef: "actuator:pump:P1", operation: "stop", zone: "zone-1",
    })).toBe(true);
  });

  it("proposal after window expiry is allowed", () => {
    const dd = new ProposalDedup({ windowMs: 1000 });
    const now = Date.now();
    const sig = { targetRef: "pump:P1", operation: "irrigate", zone: "z1" };
    dd.checkAndRecord(sig, now);
    expect(dd.checkAndRecord(sig, now + 500)).toBe(false); // Still in window
    expect(dd.checkAndRecord(sig, now + 1500)).toBe(true); // Window expired
  });

  it("isDuplicate doesn't record", () => {
    const dd = new ProposalDedup();
    const sig = { targetRef: "pump:P1", operation: "irrigate" };
    expect(dd.isDuplicate(sig)).toBe(false);
    expect(dd.isDuplicate(sig)).toBe(false); // Still false — not recorded
    dd.checkAndRecord(sig);
    expect(dd.isDuplicate(sig)).toBe(true); // Now it's recorded
  });

  it("reset clears dedup for a specific action", () => {
    const dd = new ProposalDedup();
    const sig = { targetRef: "pump:P1", operation: "irrigate", zone: "z1" };
    dd.checkAndRecord(sig);
    expect(dd.isDuplicate(sig)).toBe(true);
    dd.reset(sig);
    expect(dd.isDuplicate(sig)).toBe(false);
  });

  it("clear removes all state", () => {
    const dd = new ProposalDedup();
    dd.checkAndRecord({ targetRef: "a", operation: "b" });
    dd.checkAndRecord({ targetRef: "c", operation: "d" });
    expect(dd.size).toBe(2);
    dd.clear();
    expect(dd.size).toBe(0);
  });

  it("handles missing zone (global actions)", () => {
    const dd = new ProposalDedup();
    dd.checkAndRecord({ targetRef: "system:backup", operation: "run" });
    expect(dd.checkAndRecord({ targetRef: "system:backup", operation: "run" })).toBe(false);
  });

  it("cleanup removes expired entries", () => {
    const dd = new ProposalDedup({ windowMs: 100 });
    const now = Date.now();
    dd.checkAndRecord({ targetRef: "a", operation: "b" }, now);
    expect(dd.size).toBe(1);
    dd.checkAndRecord({ targetRef: "c", operation: "d" }, now + 200); // triggers cleanup
    expect(dd.size).toBe(1); // "a:b" cleaned up
  });

  it("tracks which planner last claimed a dedup entry", () => {
    const dd = new ProposalDedup();
    const sig = { targetRef: "pump:P1", operation: "irrigate", zone: "z1", plannerDeviceId: "planner-a" };
    dd.checkAndRecord(sig);
    expect(dd.getRecord(sig)?.plannerDeviceId).toBe("planner-a");
  });

  it("keeps cross-planner blocking while preserving original owner", () => {
    const dd = new ProposalDedup({ windowMs: 60_000 });
    dd.checkAndRecord({ targetRef: "pump:P1", operation: "irrigate", zone: "z1", plannerDeviceId: "planner-a" });
    expect(dd.checkAndRecord({ targetRef: "pump:P1", operation: "irrigate", zone: "z1", plannerDeviceId: "planner-b" })).toBe(false);
    expect(dd.getRecord({ targetRef: "pump:P1", operation: "irrigate", zone: "z1" })?.plannerDeviceId).toBe("planner-a");
  });
});

// ── Scenario: Multi-Planner Safety ────────────────────

describe("Multi-planner safety scenario", () => {
  it("two planners proposing the same irrigation are deduped", () => {
    const dd = new ProposalDedup({ windowMs: 10 * 60_000 });

    // Planner A on node-1 sees dry soil
    const result1 = dd.checkAndRecord({
      targetRef: "actuator:pump:P1",
      operation: "irrigate",
      zone: "zone-1",
    });
    expect(result1).toBe(true); // First wins

    // Planner B on node-2 sees the same condition 30 seconds later
    const result2 = dd.checkAndRecord({
      targetRef: "actuator:pump:P1",
      operation: "irrigate",
      zone: "zone-1",
    });
    expect(result2).toBe(false); // Duplicate blocked
  });

  it("irrigation after rain is allowed (conditions changed)", () => {
    const dd = new ProposalDedup({ windowMs: 10 * 60_000 });
    const sig = { targetRef: "actuator:pump:P1", operation: "irrigate", zone: "zone-1" };

    dd.checkAndRecord(sig); // First irrigation proposal

    // Rain comes, world model updates, operator resets dedup for this action
    dd.reset(sig);

    // Post-rain, soil still needs irrigation → new proposal allowed
    expect(dd.checkAndRecord(sig)).toBe(true);
  });
});
