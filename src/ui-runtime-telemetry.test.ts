import { describe, expect, it } from "vitest";
import {
  buildRuntimeTimeline,
  buildSystemEventTimeline,
  derivePlannerRuntimeSummary,
  describePlannerSurface,
  formatRelativeTime,
} from "../ui/src/lib/runtime-telemetry.js";
import type { ContextFrame, MeshRuntimeEvent, MeshRuntimeHealth, MeshRuntimeStatus } from "../ui/src/lib/store.js";

function frame(overrides: Partial<ContextFrame>): ContextFrame {
  return {
    kind: overrides.kind ?? "observation",
    frameId: overrides.frameId ?? "frame-1",
    sourceDeviceId: overrides.sourceDeviceId ?? "device-1",
    sourceDisplayName: overrides.sourceDisplayName,
    timestamp: overrides.timestamp ?? 1_000,
    data: overrides.data ?? {},
    trust: overrides.trust ?? { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    note: overrides.note,
  };
}

describe("derivePlannerRuntimeSummary", () => {
  it("surfaces queued planner state from recent agent_response frames", () => {
    const result = derivePlannerRuntimeSummary([
      frame({ kind: "human_input", timestamp: 5_000, data: { intent: "check moisture" } }),
      frame({ kind: "agent_response", timestamp: 6_000, data: { status: "queued", conversationId: "conv-1", message: "" } }),
    ], 10_000);

    expect(result.stage).toBe("queued");
    expect(result.stageLabel).toBe("Queued");
    expect(result.conversationId).toBe("conv-1");
    expect(result.lastIntent).toBe("check moisture");
  });

  it("surfaces latest reasoning when planner is idle", () => {
    const result = derivePlannerRuntimeSummary([
      frame({ kind: "inference", timestamp: 9_000, data: { reasoning: "reviewed zone-1" } }),
      frame({ kind: "agent_response", timestamp: 8_000, data: { status: "complete", message: "all good" } }),
    ], 10_000);

    expect(result.stage).toBe("idle");
    expect(result.lastAgentMessage).toContain("all good");
    expect(result.lastUpdatedLabel).toBe("just now");
  });
});

describe("buildRuntimeTimeline", () => {
  it("creates readable timeline entries from live frames", () => {
    const result = buildRuntimeTimeline([
      frame({ kind: "human_input", timestamp: 5_000, data: { intent: "hi" } }),
      frame({ kind: "agent_response", timestamp: 6_000, data: { status: "thinking", message: "" } }),
      frame({ kind: "observation", timestamp: 7_000, data: { metric: "moisture", value: 18.2, zone: "zone-1" } }),
    ], 10_000, 3);

    expect(result[0].title).toContain("observation");
    expect(result[1].title).toBe("Planner thinking");
    expect(result[2].detail).toBe("hi");
  });
});

describe("buildSystemEventTimeline", () => {
  it("maps backend events into runtime timeline entries", () => {
    const events: MeshRuntimeEvent[] = [
      { type: "peer.connect", timestamp: 8_000, message: "Connected: jetson-main" },
      { type: "proposal.created", timestamp: 9_000, message: "L2 Irrigate zone-1" },
    ];

    const result = buildSystemEventTimeline(events, 10_000, 2);
    expect(result[0].title).toBe("proposal.created");
    expect(result[0].detail).toBe("L2 Irrigate zone-1");
  });
});

describe("describePlannerSurface", () => {
  it("prefers health data and falls back to status data", () => {
    const health: MeshRuntimeHealth = {
      status: "healthy",
      nodeId: "node-1",
      uptimeMs: 60_000,
      startedAt: new Date(0).toISOString(),
      peers: { connected: 1, details: [] },
      worldModel: { entries: 5, frameLogSize: 10 },
      capabilities: { local: [], meshTotal: 0 },
      plannerMode: "active",
      plannerModelSpec: "local-llama/gemma-4-E2B-it",
      plannerLeader: { kind: "local", deviceId: "abc1234567890", role: "planner" },
      version: "0.2.0",
      timestamp: new Date(0).toISOString(),
    };
    const status: MeshRuntimeStatus = {
      localDeviceId: "node-1",
      connectedPeers: 1,
      peers: [],
      plannerMode: "standby",
      plannerModelSpec: "other/model",
    };

    const result = describePlannerSurface(health, status);
    expect(result[0]).toEqual({ label: "Planner mode", value: "active" });
    expect(result[1]).toEqual({ label: "Planner model", value: "local-llama/gemma-4-E2B-it" });
    expect(result[2].value).toContain("local:planner:abc123456789");
  });
});

describe("formatRelativeTime", () => {
  it("formats relative times compactly", () => {
    expect(formatRelativeTime(1_000)).toBe("just now");
    expect(formatRelativeTime(12_000)).toBe("12s ago");
    expect(formatRelativeTime(120_000)).toBe("2m ago");
  });
});
