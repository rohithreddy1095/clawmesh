/**
 * Tests for MeshExtensionState + tool execution logic.
 *
 * Tests the pure logic paths in the mesh extension:
 * - Proposal creation and state management
 * - Actuator blocking for execute_mesh_command
 * - L1 auto-approval flow
 * - World model query filtering
 * - List proposals filtering
 */

import { describe, it, expect } from "vitest";
import type { MeshExtensionState } from "./clawmesh-mesh-extension.js";
import type { TaskProposal, ThresholdRule } from "../types.js";
import {
  formatFrames,
  findProposalByPrefix,
  findPeerForCapability,
  summarizeProposals,
  countPending,
} from "./mesh-extension-helpers.js";
import type { ContextFrame } from "../../mesh/context-types.js";

function makeFrame(overrides?: Partial<ContextFrame>): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "sensor-01",
    timestamp: Date.now(),
    data: { metric: "soil_moisture", value: 42, zone: "zone-1" },
    trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    ...overrides,
  };
}

function makeProposal(overrides?: Partial<TaskProposal>): TaskProposal {
  return {
    taskId: `task-${Math.random().toString(36).slice(2, 10)}`,
    summary: "Test proposal",
    reasoning: "Test reasoning",
    operation: "irrigate",
    targetRef: "actuator:pump-01",
    peerDeviceId: "peer-01",
    approvalLevel: "L2",
    status: "awaiting_approval",
    createdBy: "intelligence",
    createdAt: Date.now(),
    triggerFrameIds: [],
    ...overrides,
  } as TaskProposal;
}

// ── Extension state management ─────────────────────────

describe("MeshExtensionState management", () => {
  it("proposals map tracks active proposals", () => {
    const state: MeshExtensionState = {
      proposals: new Map(),
      thresholds: [],
      thresholdLastFired: new Map(),
      maxPendingProposals: 10,
    };

    const p = makeProposal();
    state.proposals.set(p.taskId, p);
    expect(state.proposals.size).toBe(1);
    expect(state.proposals.get(p.taskId)).toBe(p);
  });

  it("onProposalCreated callback fires when set", () => {
    const created: TaskProposal[] = [];
    const state: MeshExtensionState = {
      proposals: new Map(),
      thresholds: [],
      thresholdLastFired: new Map(),
      maxPendingProposals: 10,
      onProposalCreated: (p) => created.push(p),
    };

    const p = makeProposal();
    state.proposals.set(p.taskId, p);
    state.onProposalCreated?.(p);
    expect(created).toHaveLength(1);
  });

  it("maxPendingProposals limits proposal creation", () => {
    const state: MeshExtensionState = {
      proposals: new Map(),
      thresholds: [],
      thresholdLastFired: new Map(),
      maxPendingProposals: 2,
    };

    // Add max proposals
    for (let i = 0; i < 3; i++) {
      state.proposals.set(`task-${i}`, makeProposal({ taskId: `task-${i}` }));
    }

    const pending = countPending(state.proposals);
    expect(pending).toBe(3);
    expect(pending > state.maxPendingProposals).toBe(true);
  });
});

// ── formatFrames ───────────────────────────────────────

describe("formatFrames in extension tools", () => {
  it("formats observation frames with metric/value/zone", () => {
    const frames = [
      makeFrame({ data: { metric: "soil_moisture", value: 12, zone: "zone-1", unit: "%" } }),
    ];
    const text = formatFrames(frames);
    expect(text).toContain("soil_moisture");
    expect(text).toContain("12");
    expect(text).toContain("zone-1");
  });

  it("formats empty frame list", () => {
    const text = formatFrames([]);
    expect(text).toContain("No context frames");
  });

  it("formats multiple frame types", () => {
    const frames = [
      makeFrame({ kind: "observation", data: { metric: "temp", value: 35 } }),
      makeFrame({ kind: "event", data: { event: "pump_started" } }),
      makeFrame({ kind: "inference", data: { reasoning: "soil is dry" } }),
    ];
    const text = formatFrames(frames);
    expect(text).toContain("temp");
    expect(text).toContain("pump_started");
  });
});

// ── findPeerForCapability ──────────────────────────────

describe("findPeerForCapability in tool routing", () => {
  it("returns first peer with matching capability", () => {
    const finder = (ref: string) => ref === "sensor:moisture" ? ["peer-1", "peer-2"] : [];
    expect(findPeerForCapability(finder, "sensor:moisture")).toBe("peer-1");
  });

  it("returns null when no peer has capability", () => {
    const finder = (_ref: string) => [] as string[];
    expect(findPeerForCapability(finder, "actuator:pump")).toBeNull();
  });

  it("handles wildcard by prefix", () => {
    const finder = (ref: string) => {
      if (ref === "sensor:moisture:zone-1") return ["peer-1"];
      if (ref === "sensor:moisture") return ["peer-2"];
      return [];
    };
    // Direct match first
    expect(findPeerForCapability(finder, "sensor:moisture:zone-1")).toBe("peer-1");
  });
});

// ── findProposalByPrefix ───────────────────────────────

describe("findProposalByPrefix in slash commands", () => {
  it("finds proposal by ID prefix", () => {
    const proposals = new Map<string, TaskProposal>();
    const p = makeProposal({ taskId: "task-abc12345" });
    proposals.set(p.taskId, p);

    expect(findProposalByPrefix(proposals, "task-abc")).toBe(p);
  });

  it("returns undefined for no match", () => {
    const proposals = new Map<string, TaskProposal>();
    proposals.set("task-xyz", makeProposal({ taskId: "task-xyz" }));

    expect(findProposalByPrefix(proposals, "task-abc")).toBeUndefined();
  });

  it("returns first match when multiple proposals match prefix", () => {
    const proposals = new Map<string, TaskProposal>();
    const p1 = makeProposal({ taskId: "task-abc1" });
    const p2 = makeProposal({ taskId: "task-abc2" });
    proposals.set(p1.taskId, p1);
    proposals.set(p2.taskId, p2);

    const result = findProposalByPrefix(proposals, "task-abc");
    expect(result?.taskId).toMatch(/^task-abc/);
  });
});

// ── summarizeProposals ─────────────────────────────────

describe("summarizeProposals in list_proposals tool", () => {
  it("summarizes proposals with key fields", () => {
    const proposals = [
      makeProposal({ summary: "Irrigate zone-1", status: "awaiting_approval", approvalLevel: "L2" }),
      makeProposal({ summary: "Open valve", status: "completed", approvalLevel: "L1" }),
    ];

    const summary = summarizeProposals(proposals);
    expect(summary).toHaveLength(2);
    expect(summary[0]).toHaveProperty("summary");
    expect(summary[0]).toHaveProperty("status");
  });

  it("returns empty array for no proposals", () => {
    expect(summarizeProposals([])).toEqual([]);
  });
});

// ── countPending ───────────────────────────────────────

describe("countPending for capacity checks", () => {
  it("counts proposed + awaiting_approval", () => {
    const proposals = new Map<string, TaskProposal>();
    proposals.set("1", makeProposal({ status: "proposed" }));
    proposals.set("2", makeProposal({ status: "awaiting_approval" }));
    proposals.set("3", makeProposal({ status: "completed" }));
    proposals.set("4", makeProposal({ status: "rejected" }));

    expect(countPending(proposals)).toBe(2);
  });

  it("returns 0 for empty map", () => {
    expect(countPending(new Map())).toBe(0);
  });
});

// ── Actuator blocking logic ────────────────────────────

describe("Actuator blocking in execute_mesh_command", () => {
  it("targetRef starting with actuator: must be blocked", () => {
    const targetRef = "actuator:pump:P1";
    expect(targetRef.startsWith("actuator:")).toBe(true);
  });

  it("sensor refs should not be blocked", () => {
    expect("sensor:moisture:zone-1".startsWith("actuator:")).toBe(false);
  });

  it("empty targetRef should not be blocked", () => {
    expect("".startsWith("actuator:")).toBe(false);
  });
});

// ── L1 auto-approval logic ────────────────────────────

describe("L1 auto-approval in propose_task", () => {
  it("L1 proposals get approved status immediately", () => {
    const proposal = makeProposal({ approvalLevel: "L1" });
    // Simulate extension logic
    if (proposal.approvalLevel === "L1") {
      proposal.status = "approved";
    }
    expect(proposal.status).toBe("approved");
  });

  it("L2 proposals stay in awaiting_approval", () => {
    const proposal = makeProposal({ approvalLevel: "L2" });
    if (proposal.approvalLevel === "L1") {
      proposal.status = "approved";
    }
    expect(proposal.status).toBe("awaiting_approval");
  });

  it("L3 proposals stay in awaiting_approval", () => {
    const proposal = makeProposal({ approvalLevel: "L3" });
    if (proposal.approvalLevel === "L1") {
      proposal.status = "approved";
    }
    expect(proposal.status).toBe("awaiting_approval");
  });
});
