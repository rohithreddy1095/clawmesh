import { describe, expect, it } from "vitest";
import {
  buildFrameActivityBars,
  buildObservationStores,
  buildTopologyGraph,
} from "../ui/src/lib/runtime-topology.js";
import type { ContextFrame, MeshPeer, MeshRuntimeHealth, MeshRuntimeStatus } from "../ui/src/lib/store.js";

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

describe("buildTopologyGraph", () => {
  it("maps local, connected, and configured offline peers into a live graph", () => {
    const runtimeHealth: MeshRuntimeHealth = {
      status: "healthy",
      nodeId: "mac-local-id...",
      displayName: "mac-command-center",
      uptimeMs: 60_000,
      startedAt: new Date(0).toISOString(),
      peers: { connected: 1, details: [] },
      worldModel: { entries: 14, frameLogSize: 100 },
      capabilities: { local: ["channel:clawmesh"], meshTotal: 1 },
      plannerMode: "active",
      plannerModelSpec: "local-llama/gemma-4-E2B-it",
      version: "0.2.0",
      timestamp: new Date(0).toISOString(),
    };
    const runtimeStatus: MeshRuntimeStatus = {
      localDeviceId: "mac-local-id",
      connectedPeers: 1,
      peers: [
        {
          deviceId: "jetson-peer-id",
          displayName: "jetson-main",
          outbound: true,
          role: "field",
          transportLabel: "local",
          connectedAtMs: 1_000,
        },
      ],
      configuredStaticPeers: [
        { deviceId: "jetson-peer-id", url: "ws://jetson:18789", transportLabel: "local" },
        { deviceId: "relay-peer-id", url: "wss://relay.example", transportLabel: "relay" },
      ],
      pendingProposals: [],
    };
    const peerDirectory: Record<string, MeshPeer> = {
      "jetson-peer-id": {
        deviceId: "jetson-peer-id",
        displayName: "jetson-main",
        capabilities: ["sensor:moisture", "actuator:pump"],
      },
      "relay-peer-id": {
        deviceId: "relay-peer-id",
        displayName: "relay-link",
        capabilities: ["channel:clawmesh"],
      },
    };

    const result = buildTopologyGraph({
      runtimeHealth,
      runtimeStatus,
      peerDirectory,
      frames: [
        frame({
          frameId: "obs-1",
          sourceDeviceId: "jetson-peer-id",
          sourceDisplayName: "jetson-main",
          timestamp: 5_000,
          data: { metric: "moisture", value: 32.7, zone: "zone-1" },
        }),
      ],
    });

    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);

    const localNode = result.nodes.find((node) => node.isLocal);
    expect(localNode?.label).toBe("mac-command-center");
    expect(localNode?.contextSummary).toContain("Planner active");

    const connectedPeer = result.nodes.find((node) => node.deviceId === "jetson-peer-id");
    expect(connectedPeer?.status).toBe("active");
    expect(connectedPeer?.type).toBe("field");
    expect(connectedPeer?.contextSummary).toContain("moisture: 32.7");

    const offlinePeer = result.nodes.find((node) => node.deviceId === "relay-peer-id");
    expect(offlinePeer?.status).toBe("idle");
    expect(offlinePeer?.contextSummary).toContain("offline");

    expect(result.edges.find((edge) => edge.target === "jetson-peer-id")?.status).toBe("connected");
    expect(result.edges.find((edge) => edge.target === "relay-peer-id")?.status).toBe("configured");
  });
});

describe("buildFrameActivityBars", () => {
  it("counts recent runtime frames by kind", () => {
    const result = buildFrameActivityBars([
      frame({ kind: "observation", frameId: "obs-1" }),
      frame({ kind: "observation", frameId: "obs-2" }),
      frame({ kind: "human_input", frameId: "human-1" }),
      frame({ kind: "agent_response", frameId: "agent-1" }),
    ]);

    expect(result.find((bar) => bar.key === "observation")?.count).toBe(2);
    expect(result.find((bar) => bar.key === "human_input")?.count).toBe(1);
    expect(result.find((bar) => bar.key === "agent_response")?.count).toBe(1);
  });
});

describe("buildObservationStores", () => {
  it("keeps the latest reading per source/metric/zone and formats it for cards", () => {
    const result = buildObservationStores([
      frame({
        frameId: "old-moisture",
        sourceDeviceId: "jetson-peer-id",
        sourceDisplayName: "jetson-main",
        timestamp: 3_000,
        data: { metric: "moisture", value: 21.3, zone: "zone-1" },
      }),
      frame({
        frameId: "new-moisture",
        sourceDeviceId: "jetson-peer-id",
        sourceDisplayName: "jetson-main",
        timestamp: 5_000,
        data: { metric: "moisture", value: 32.7, zone: "zone-1" },
      }),
      frame({
        frameId: "air-temp",
        sourceDeviceId: "weather-node",
        sourceDisplayName: "weather-node",
        timestamp: 4_000,
        data: { metric: "air_temp", value: 29.1, zone: "zone-2" },
      }),
    ], 10_000, 4);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "new-moisture",
      label: "moisture · zone-1",
      value: "32.7",
      source: "jetson-main",
    });
    expect(result[1].label).toBe("air_temp · zone-2");
  });
});
