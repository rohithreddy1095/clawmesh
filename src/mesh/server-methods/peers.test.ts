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
      }>;
    };
    expect(p.peers).toHaveLength(1);
    expect(p.peers[0].deviceId).toBe("peer-a");
    expect(p.peers[0].displayName).toBe("Mac");
    expect(p.peers[0].outbound).toBe(true);
    expect(p.peers[0].capabilities).toEqual(["channel:telegram"]);
    expect(p.peers[0].role).toBe("viewer");
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
      plannerActivity?: { state: string; leader: { kind: string } };
      pendingProposals?: Array<{ plannerOwner?: string; summary: string }>;
    };
    expect(s.localDeviceId).toBe("local-device");
    expect(s.connectedPeers).toBe(1);
    expect(s.peers).toHaveLength(1);
    expect((s.peers[0] as { role?: string }).role).toBe("planner");
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
