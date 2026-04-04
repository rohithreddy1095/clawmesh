import { describe, expect, it, vi, beforeEach } from "vitest";
import { MeshCapabilityRegistry } from "../capabilities.js";
import { PeerRegistry } from "../peer-registry.js";
import type { PeerSession } from "../types.js";
import { createMeshPeersHandlers } from "./peers.js";

type Handlers = Record<string, (opts: {
  params: Record<string, unknown>;
  respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void;
}) => void | Promise<void>>;

function createMockSocket() {
  return { send: vi.fn(), close: vi.fn(), readyState: 1 } as unknown as PeerSession["socket"];
}

function callHandler(
  handlers: Handlers,
  method: string,
  params: Record<string, unknown> = {},
) {
  return new Promise<{ ok: boolean; payload?: unknown; error?: { code: string; message: string } }>((resolve) => {
    const respond = (ok: boolean, payload?: unknown, error?: { code: string; message: string }) =>
      resolve({ ok, payload, error });
    void handlers[method]({ params, respond });
  });
}

describe("mesh.peers handler", () => {
  let peerRegistry: PeerRegistry;
  let capabilityRegistry: MeshCapabilityRegistry;
  let handlers: Handlers;

  beforeEach(() => {
    peerRegistry = new PeerRegistry();
    capabilityRegistry = new MeshCapabilityRegistry();
    handlers = createMeshPeersHandlers({
      peerRegistry,
      capabilityRegistry,
      localDeviceId: "local-device",
      getPlannerActivity: () => ({
        state: "active",
        shouldHandleAutonomous: true,
        role: "planner",
        leader: { kind: "local", deviceId: "local-device", role: "planner" },
      }),
      getPlannerMode: () => "active",
      getPlannerModelSpec: () => "local-llama/gemma-4-E2B-it",
      getPlannerRuntime: () => ({
        mode: "active",
        stage: "tool",
        running: true,
        queueDepth: 2,
        queue: { operatorIntent: 1, thresholdBreach: 1, proactiveCheck: 0 },
        activeTriggerType: "operator_intent",
        activeReason: "check zone-1",
        activeConversationId: "conv-1",
        activeRequestId: "req-1",
        activeToolName: "query_world_model",
        lastToolName: "query_world_model",
        lastIntent: "check zone-1",
        updatedAtMs: 1234,
      }),
      isDiscoveryEnabled: () => false,
      getConfiguredStaticPeers: () => ([{
        deviceId: "peer-static",
        url: "wss://relay.example.com/mesh",
        transportLabel: "relay",
        securityPosture: "tls-unpinned",
      }]),
      getPendingProposals: () => ([{
        taskId: "task-1234...",
        summary: "Irrigate zone-1",
        approvalLevel: "L2",
        status: "awaiting_approval",
        plannerDeviceId: "planner-abcdef1234567890",
        plannerRole: "planner",
        plannerOwner: "planner:planner-abcd…",
      }]),
    });
  });

  it("mesh.peers returns connected peer list", async () => {
    peerRegistry.register({
      deviceId: "peer-a",
      connId: "c1",
      displayName: "Mac",
      socket: createMockSocket(),
      outbound: true,
      capabilities: ["channel:telegram"],
      role: "viewer",
      transportLabel: "relay",
      connectedAtMs: 1000,
    });

    const { ok, payload } = await callHandler(handlers, "mesh.peers");
    expect(ok).toBe(true);
    const p = payload as {
      peers: Array<{
        deviceId: string;
        displayName: string;
        outbound: boolean;
        capabilities: string[];
        role?: string;
        transportLabel?: string;
      }>;
    };
    expect(p.peers).toHaveLength(1);
    expect(p.peers[0].deviceId).toBe("peer-a");
    expect(p.peers[0].displayName).toBe("Mac");
    expect(p.peers[0].outbound).toBe(true);
    expect(p.peers[0].capabilities).toEqual(["channel:telegram"]);
    expect(p.peers[0].role).toBe("viewer");
    expect(p.peers[0].transportLabel).toBe("relay");
  });

  it("mesh.status returns localDeviceId and peerCount", async () => {
    peerRegistry.register({
      deviceId: "peer-a",
      connId: "c1",
      socket: createMockSocket(),
      outbound: false,
      role: "planner",
      capabilities: [],
      connectedAtMs: 1000,
    });

    const { ok, payload } = await callHandler(handlers, "mesh.status");
    expect(ok).toBe(true);
    const s = payload as {
      localDeviceId: string;
      connectedPeers: number;
      peers: unknown[];
      discoveryEnabled?: boolean;
      plannerActivity?: { state: string; leader: { kind: string } };
      plannerMode?: string;
      plannerModelSpec?: string;
      plannerRuntime?: { stage: string; activeToolName?: string; queueDepth: number };
      configuredStaticPeers?: Array<{ transportLabel?: string; url: string; securityPosture?: string }>;
      pendingProposals?: Array<{ plannerOwner?: string; summary: string }>;
    };
    expect(s.localDeviceId).toBe("local-device");
    expect(s.connectedPeers).toBe(1);
    expect(s.peers).toHaveLength(1);
    expect((s.peers[0] as { role?: string }).role).toBe("planner");
    expect(s.plannerMode).toBe("active");
    expect(s.plannerModelSpec).toBe("local-llama/gemma-4-E2B-it");
    expect(s.plannerRuntime?.stage).toBe("tool");
    expect(s.plannerRuntime?.activeToolName).toBe("query_world_model");
    expect(s.plannerRuntime?.queueDepth).toBe(2);
    expect(s.discoveryEnabled).toBe(false);
    expect(s.configuredStaticPeers?.[0].url).toBe("wss://relay.example.com/mesh");
    expect(s.configuredStaticPeers?.[0].transportLabel).toBe("relay");
    expect(s.configuredStaticPeers?.[0].securityPosture).toBe("tls-unpinned");
    expect(s.plannerActivity?.state).toBe("active");
    expect(s.plannerActivity?.leader.kind).toBe("local");
    expect(s.pendingProposals?.[0].summary).toBe("Irrigate zone-1");
    expect(s.pendingProposals?.[0].plannerOwner).toBe("planner:planner-abcd…");
  });

  it("no peers returns empty list", async () => {
    const { ok, payload } = await callHandler(handlers, "mesh.peers");
    expect(ok).toBe(true);
    expect((payload as { peers: unknown[] }).peers).toEqual([]);
  });
});
