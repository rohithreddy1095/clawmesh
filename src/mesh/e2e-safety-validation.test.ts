/**
 * End-to-end system safety validation — tests the complete chain
 * from sensor data through planner to operator decision.
 */

import { describe, it, expect } from "vitest";
import { ProposalManager } from "../agents/proposal-manager.js";
import { ProposalDedup } from "../agents/proposal-dedup.js";
import { buildProposalContext } from "../agents/proposal-context.js";
import { classifyFreshness, getDataFreshnessWarnings } from "./data-freshness.js";
import { SystemEventLog } from "./system-event-log.js";
import type { TaskProposal } from "../agents/types.js";
import type { ContextFrame } from "./context-types.js";

function makeProposal(overrides?: Partial<TaskProposal>): TaskProposal {
  return {
    taskId: `task-${Math.random().toString(36).slice(2, 8)}`,
    summary: "Irrigate zone-1",
    reasoning: "Soil moisture below threshold",
    operation: "irrigate",
    targetRef: "actuator:pump:zone-1:P1",
    peerDeviceId: "peer-01",
    approvalLevel: "L2",
    status: "awaiting_approval",
    createdBy: "intelligence",
    createdAt: Date.now(),
    triggerFrameIds: ["f-001"],
  } as TaskProposal;
}

function makeFrame(data: Record<string, unknown>, ts = Date.now()): ContextFrame {
  return {
    kind: "observation", frameId: `f-${Math.random().toString(36).slice(2)}`,
    sourceDeviceId: "sensor-01", timestamp: ts,
    data, trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
  };
}

describe("E2E: Happy path — sensor → planner → approve → execute", () => {
  it("complete flow works with all safety checks passing", () => {
    const pm = new ProposalManager();
    const dd = new ProposalDedup();
    const log = new SystemEventLog();
    const now = Date.now();

    // 1. Fresh sensor data
    const frame = makeFrame({ metric: "soil_moisture", value: 12, zone: "zone-1", unit: "%" }, now - 5000);
    const freshness = classifyFreshness(now - 5000, now);
    expect(freshness).toBe("fresh");

    // 2. Planner creates proposal, dedup allows it
    expect(dd.checkAndRecord({ targetRef: "actuator:pump:zone-1:P1", operation: "irrigate", zone: "zone-1" })).toBe(true);
    const proposal = makeProposal({ createdAt: now - 60_000 });
    pm.add(proposal);
    log.record("proposal.created", proposal.summary);

    // 3. Not expired yet
    expect(pm.isExpired(proposal.taskId, now)).toBe(false);

    // 4. Build context for operator
    const ctx = buildProposalContext(proposal, [frame]);
    expect(ctx.warnings).toHaveLength(0); // Fresh data, recent proposal
    expect(ctx.currentConditions[0].value).toBe(12);

    // 5. Operator approves
    const approved = pm.approve(proposal.taskId);
    expect(approved).not.toBeNull();
    log.record("proposal.resolved", `Approved: ${proposal.summary}`);

    // 6. Verify event log
    expect(log.summary().proposals).toBe(2);
  });
});

describe("E2E: Safety net — stale data + expired proposal", () => {
  it("system prevents action on outdated conditions", () => {
    const pm = new ProposalManager();
    const now = Date.now();

    // 1. Old sensor data (15 min ago)
    const staleFrame = makeFrame({ metric: "soil_moisture", value: 12, zone: "zone-1" }, now - 15 * 60_000);
    const freshness = classifyFreshness(staleFrame.timestamp, now);
    expect(["stale", "aging"]).toContain(freshness);

    // 2. Old proposal (35 min ago — manually constructed, no helper, to control createdAt exactly)
    const proposal: TaskProposal = {
      taskId: "task-stale",
      summary: "Irrigate zone-1",
      reasoning: "Old reading",
      operation: "irrigate",
      targetRef: "actuator:pump:zone-1:P1",
      peerDeviceId: "peer-01",
      approvalLevel: "L2",
      status: "awaiting_approval",
      createdBy: "intelligence",
      createdAt: now - 35 * 60_000, // 35 min ago
      triggerFrameIds: [],
    };
    pm.add(proposal);

    // 3. Context shows warnings
    const ctx = buildProposalContext(proposal, [staleFrame], undefined, now);
    expect(ctx.warnings.length).toBeGreaterThan(0); // Both stale data + old proposal

    // 4. Sweep catches it (proposal expires at createdAt + 30min = now - 5min → expired)
    const swept = pm.sweepExpired(now);
    expect(swept).toContain("task-stale");
    expect(pm.get("task-stale")!.status).toBe("rejected");
  });
});

describe("E2E: Multi-planner safety", () => {
  it("prevents double-action from independent planners", () => {
    const dd = new ProposalDedup({ windowMs: 10 * 60_000 });
    const pm = new ProposalManager();

    // Planner A creates proposal
    dd.checkAndRecord({ targetRef: "pump:P1", operation: "irrigate", zone: "zone-1" });
    pm.add(makeProposal({ taskId: "planner-A-task" }));

    // Planner B tries same action
    const allowed = dd.checkAndRecord({ targetRef: "pump:P1", operation: "irrigate", zone: "zone-1" });
    expect(allowed).toBe(false); // Blocked

    // Only 1 proposal exists
    expect(pm.list({ status: "awaiting_approval" })).toHaveLength(1);
  });
});
