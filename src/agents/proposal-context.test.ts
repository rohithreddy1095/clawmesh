/**
 * Tests for ProposalContext — decision context enrichment.
 */

import { describe, it, expect } from "vitest";
import { buildProposalContext } from "./proposal-context.js";
import type { TaskProposal } from "./types.js";
import type { ContextFrame } from "../mesh/context-types.js";

function makeProposal(overrides?: Partial<TaskProposal>): TaskProposal {
  return {
    taskId: "task-abc",
    summary: "Irrigate zone-1",
    reasoning: "Soil moisture at 12%",
    operation: "irrigate",
    targetRef: "actuator:pump:zone-1:P1",
    peerDeviceId: "peer-01",
    approvalLevel: "L2",
    status: "awaiting_approval",
    createdBy: "intelligence",
    createdAt: Date.now() - 5 * 60_000, // 5 min ago
    triggerFrameIds: ["f-001"],
    ...overrides,
  } as TaskProposal;
}

function makeFrame(overrides?: Partial<ContextFrame>): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "sensor-01",
    timestamp: Date.now() - 30_000,
    data: { metric: "soil_moisture", value: 12, zone: "zone-1", unit: "%" },
    trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    ...overrides,
  };
}

describe("buildProposalContext", () => {
  it("includes proposal details with age", () => {
    const ctx = buildProposalContext(makeProposal(), []);
    expect(ctx.proposal.summary).toBe("Irrigate zone-1");
    expect(ctx.proposal.age).toContain("m"); // "5m"
    expect(ctx.proposal.approvalLevel).toBe("L2");
  });

  it("includes relevant sensor readings", () => {
    const frames = [
      makeFrame({ data: { metric: "soil_moisture", value: 12, zone: "zone-1", unit: "%" } }),
      makeFrame({ data: { metric: "temperature", value: 35, zone: "zone-1" } }),
      makeFrame({ data: { metric: "humidity", value: 60, zone: "zone-2" } }), // Different zone
    ];

    const ctx = buildProposalContext(makeProposal(), frames);
    // Only zone-1 frames
    expect(ctx.currentConditions).toHaveLength(2);
    expect(ctx.currentConditions[0].metric).toBe("soil_moisture");
  });

  it("includes pattern history when available", () => {
    const patterns = [{
      triggerCondition: "moisture < 20%",
      action: { operation: "irrigate", targetRef: "actuator:pump:zone-1:P1" },
      approvalCount: 5,
      rejectionCount: 1,
      confidence: 0.83,
    }];

    const ctx = buildProposalContext(makeProposal(), [], patterns);
    expect(ctx.patternHistory).not.toBeUndefined();
    expect(ctx.patternHistory!.previousApprovals).toBe(5);
    expect(ctx.patternHistory!.confidence).toBe(0.83);
  });

  it("warns about old proposals", () => {
    const old = makeProposal({ createdAt: Date.now() - 20 * 60_000 }); // 20 min old
    const ctx = buildProposalContext(old, []);
    expect(ctx.warnings.some(w => w.includes("old"))).toBe(true);
  });

  it("warns when no sensor data available", () => {
    const ctx = buildProposalContext(makeProposal(), []);
    expect(ctx.warnings.some(w => w.includes("No current sensor data"))).toBe(true);
  });

  it("warns about stale sensor data", () => {
    const staleFrame = makeFrame({
      timestamp: Date.now() - 20 * 60_000, // 20 min old
    });
    const ctx = buildProposalContext(makeProposal(), [staleFrame]);
    expect(ctx.warnings.some(w => w.includes("stale"))).toBe(true);
  });

  it("fresh proposal with fresh data has no warnings", () => {
    const freshProposal = makeProposal({ createdAt: Date.now() - 60_000 }); // 1 min
    const freshFrame = makeFrame({ timestamp: Date.now() - 10_000 }); // 10s
    const ctx = buildProposalContext(freshProposal, [freshFrame]);
    expect(ctx.warnings).toHaveLength(0);
  });

  it("handles targetRef without zone", () => {
    const proposal = makeProposal({ targetRef: "actuator:backup:system" });
    const frames = [makeFrame({ data: { metric: "m", value: 1, zone: "zone-1" } })];
    const ctx = buildProposalContext(proposal, frames);
    // Should include all frames since no zone filter
    expect(ctx.currentConditions.length).toBeGreaterThanOrEqual(1);
  });
});
