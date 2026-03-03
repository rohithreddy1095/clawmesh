import { describe, it, expect } from "vitest";
import type { FarmContext, ThresholdRule, TaskProposal, ApprovalLevel } from "../agents/types.js";
import { loadBhoomiContext } from "../agents/farm-context-loader.js";

describe("farm-context-loader", () => {
  it("loads Bhoomi context with expected structure", () => {
    const ctx = loadBhoomiContext();

    expect(ctx.siteName).toContain("Bhoomi");
    expect(ctx.zones.length).toBeGreaterThan(0);
    expect(ctx.zones[0].zoneId).toBe("z-site-root");
    expect(ctx.safetyRules.length).toBeGreaterThan(5);
  });

  it("loads operations from the library", () => {
    const ctx = loadBhoomiContext();

    expect(ctx.operations.length).toBeGreaterThan(0);
    const opNames = ctx.operations.map((o) => o.name);
    // Should contain operations from the YAML
    expect(opNames.some((n) => n.includes("Jeevamrit"))).toBe(true);
    expect(opNames.some((n) => n.includes("Irrigation") || n.includes("Water"))).toBe(true);
  });

  it("loads assets including mesh nodes", () => {
    const ctx = loadBhoomiContext();

    const assetIds = ctx.assets.map((a) => a.assetId);
    expect(assetIds).toContain("mac-main");
    expect(assetIds).toContain("jetson-field-01");
  });

  it("includes priority crops in zone data", () => {
    const ctx = loadBhoomiContext();

    const rootZone = ctx.zones.find((z) => z.zoneId === "z-site-root");
    expect(rootZone?.crops).toBeDefined();
    expect(rootZone!.crops!.length).toBeGreaterThan(0);
    // Should include Mango from priority crops
    expect(rootZone!.crops!.some((c) => c.includes("Mango"))).toBe(true);
  });

  it("all operations have valid approval levels", () => {
    const ctx = loadBhoomiContext();
    const validLevels = new Set(["L0", "L1", "L2", "L3"]);

    for (const op of ctx.operations) {
      expect(validLevels.has(op.approvalLevel)).toBe(true);
    }
  });
});

describe("planner types", () => {
  it("TaskProposal has correct shape", () => {
    const proposal: TaskProposal = {
      taskId: "test-123",
      summary: "Start pump P1 for zone-1 irrigation",
      reasoning: "Moisture at 14% — below 20% critical threshold",
      targetRef: "actuator:pump:P1",
      operation: "start",
      operationParams: { durationSec: 1800 },
      peerDeviceId: "abc123",
      approvalLevel: "L2",
      status: "awaiting_approval",
      createdBy: "intelligence",
      triggerFrameIds: ["frame-1"],
      createdAt: Date.now(),
    };

    expect(proposal.status).toBe("awaiting_approval");
    expect(proposal.approvalLevel).toBe("L2");
    expect(proposal.targetRef).toContain("actuator:");
  });

  it("ThresholdRule triggers correctly on below threshold", () => {
    const rule: ThresholdRule = {
      ruleId: "moisture-critical",
      metric: "moisture",
      belowThreshold: 20,
      cooldownMs: 300_000,
      promptHint: "Moisture critical",
    };

    // Simulating the threshold check logic
    const value = 15;
    const breached = rule.belowThreshold !== undefined && value < rule.belowThreshold;
    expect(breached).toBe(true);
  });

  it("ThresholdRule does not trigger above threshold", () => {
    const rule: ThresholdRule = {
      ruleId: "moisture-critical",
      metric: "moisture",
      belowThreshold: 20,
      cooldownMs: 300_000,
      promptHint: "Moisture critical",
    };

    const value = 25;
    const breached = rule.belowThreshold !== undefined && value < rule.belowThreshold;
    expect(breached).toBe(false);
  });
});
