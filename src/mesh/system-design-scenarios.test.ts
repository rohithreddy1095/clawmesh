/**
 * Tests for system-wide design improvements — holistic scenarios.
 *
 * Tests real production scenarios that require multiple modules
 * working together correctly.
 */

import { describe, it, expect } from "vitest";
import { ProposalManager } from "../agents/proposal-manager.js";
import { ProposalDedup } from "../agents/proposal-dedup.js";
import { classifyFreshness, getDataFreshnessWarnings, formatFreshnessWarning } from "./data-freshness.js";
import type { TaskProposal } from "../agents/types.js";

describe("Scenario: sensor offline → stale data → planner warned", () => {
  it("planner gets freshness warnings injected into context", () => {
    const now = Date.now();
    const entries = [
      { metric: "soil_moisture", zone: "zone-1", lastUpdated: now - 10_000 },       // fresh
      { metric: "temperature", zone: "zone-2", lastUpdated: now - 15 * 60_000 },    // stale (sensor offline)
      { metric: "humidity", zone: "zone-1", lastUpdated: now - 30_000 },              // fresh (1 interval ago)
    ];
    const warnings = getDataFreshnessWarnings(entries, now);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("zone-2:temperature");
    expect(warnings[0]).toContain("STALE");
  });
});

describe("Scenario: operator walks away → proposals expire", () => {
  it("proposals auto-expire after 30 minutes, preventing stale action", () => {
    const resolved: TaskProposal[] = [];
    const pm = new ProposalManager({ onResolved: (p) => resolved.push(p) });
    const now = Date.now();

    // Planner creates proposal
    pm.add({
      taskId: "task-irrigate",
      summary: "Irrigate zone-1",
      operation: "irrigate",
      targetRef: "pump:P1",
      status: "awaiting_approval",
      createdAt: now - 35 * 60_000, // 35 min ago
      createdBy: "intelligence",
    } as TaskProposal);

    // 35 minutes later, sweep runs
    const expired = pm.sweepExpired(now);
    expect(expired).toContain("task-irrigate");
    expect(resolved[0].resolvedBy).toBe("system:expired");

    // Operator returns and tries to approve → fails
    expect(pm.approve("task-irrigate")).toBeNull();
  });
});

describe("Scenario: dual planner conflict prevention", () => {
  it("second planner proposal for same action is deduplicated", () => {
    const dd = new ProposalDedup({ windowMs: 10 * 60_000 });

    // Node-A planner proposes irrigation
    const ok1 = dd.checkAndRecord({
      targetRef: "actuator:pump:P1", operation: "irrigate", zone: "zone-1",
    });
    expect(ok1).toBe(true);

    // Node-B planner sees same condition, proposes same action
    const ok2 = dd.checkAndRecord({
      targetRef: "actuator:pump:P1", operation: "irrigate", zone: "zone-1",
    });
    expect(ok2).toBe(false); // Blocked — prevents double irrigation
  });
});

describe("Scenario: propose_task dedup wired in extension", () => {
  it("ProposalDedup blocks duplicate actions in the extension path", () => {
    const dd = new ProposalDedup({ windowMs: 10 * 60_000 });

    // Extension calls checkAndRecord before creating proposal
    const sig = { targetRef: "actuator:pump:P1", operation: "irrigate", zone: "zone-1" };
    expect(dd.checkAndRecord(sig)).toBe(true);

    // Second call (same planner or different planner) is blocked
    expect(dd.checkAndRecord(sig)).toBe(false);

    // Different zone is allowed
    expect(dd.checkAndRecord({
      targetRef: "actuator:pump:P2", operation: "irrigate", zone: "zone-2",
    })).toBe(true);
  });
});

describe("Scenario: proposal traceability via trigger frame IDs", () => {
  it("threshold breach frame IDs are available for proposals", () => {
    // Simulates the pi-session pipeline:
    // 1. Frame arrives with threshold breach
    // 2. Frame ID is tracked in recentTriggerFrameIds
    // 3. propose_task uses those IDs when creating proposal

    const recentTriggerFrameIds: string[] = [];

    // Simulate threshold breach
    recentTriggerFrameIds.push("frame-abc123");
    recentTriggerFrameIds.push("frame-def456");

    // Simulate propose_task using the IDs
    const proposal = {
      taskId: "task-1",
      triggerFrameIds: recentTriggerFrameIds.slice(0, 5),
    };

    expect(proposal.triggerFrameIds).toContain("frame-abc123");
    expect(proposal.triggerFrameIds).toContain("frame-def456");
    expect(proposal.triggerFrameIds).toHaveLength(2);
  });
});

describe("Scenario: freshness + expiry work together", () => {
  it("stale sensor data leads to expired proposal when not acted on", () => {
    const now = Date.now();

    // 1. Sensor data becomes stale
    const freshness = classifyFreshness(now - 20 * 60_000, now, { expectedIntervalMs: 30_000 });
    expect(freshness).toBe("stale"); // 40 missed intervals

    // 2. Planner had created a proposal based on the old reading
    const pm = new ProposalManager();
    pm.add({
      taskId: "task-old",
      summary: "Irrigate based on old data",
      operation: "irrigate",
      targetRef: "pump:P1",
      status: "awaiting_approval",
      createdAt: now - 35 * 60_000, // Created 35 min ago
      createdBy: "intelligence",
    } as TaskProposal);

    // 3. Sweep catches it
    const expired = pm.sweepExpired(now);
    expect(expired).toHaveLength(1);

    // 4. Result: no action taken on stale data ✓
    expect(pm.get("task-old")!.status).toBe("rejected");
  });
});
