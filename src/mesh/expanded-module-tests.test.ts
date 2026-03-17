/**
 * Expanded tests for under-covered modules: server-methods, forwarding, routing.
 */

import { describe, it, expect, vi } from "vitest";
import { resolveMeshRoute } from "./routing.js";
import { MeshCapabilityRegistry } from "./capabilities.js";
import { createMeshPeersHandlers } from "./server-methods/peers.js";
import { createContextSyncHandlers } from "./server-methods/context-sync.js";
import { WorldModel } from "./world-model.js";
import { PeerRegistry } from "./peer-registry.js";

// ─── Routing expanded ───────────────────────────────

describe("resolveMeshRoute - comprehensive", () => {
  it("local takes priority over mesh", () => {
    const reg = new MeshCapabilityRegistry();
    reg.updatePeer("peer-1", ["channel:telegram"]);
    const result = resolveMeshRoute({
      channel: "telegram",
      capabilityRegistry: reg,
      localCapabilities: new Set(["channel:telegram"]),
    });
    expect(result.kind).toBe("local");
  });

  it("finds mesh peer when no local capability", () => {
    const reg = new MeshCapabilityRegistry();
    reg.updatePeer("peer-1", ["channel:whatsapp"]);
    const result = resolveMeshRoute({
      channel: "whatsapp",
      capabilityRegistry: reg,
      localCapabilities: new Set(["channel:telegram"]),
    });
    expect(result).toEqual({ kind: "mesh", peerDeviceId: "peer-1" });
  });

  it("returns unavailable for unknown channel", () => {
    const reg = new MeshCapabilityRegistry();
    const result = resolveMeshRoute({
      channel: "unknown",
      capabilityRegistry: reg,
    });
    expect(result.kind).toBe("unavailable");
  });

  it("handles undefined localCapabilities", () => {
    const reg = new MeshCapabilityRegistry();
    const result = resolveMeshRoute({
      channel: "test",
      capabilityRegistry: reg,
    });
    expect(result.kind).toBe("unavailable");
  });

  it("handles empty local and mesh", () => {
    const reg = new MeshCapabilityRegistry();
    const result = resolveMeshRoute({
      channel: "test",
      capabilityRegistry: reg,
      localCapabilities: new Set(),
    });
    expect(result.kind).toBe("unavailable");
  });
});

// ─── mesh.peers handler ─────────────────────────────

describe("createMeshPeersHandlers - expanded", () => {
  it("returns handler for mesh.peers", () => {
    const handlers = createMeshPeersHandlers({
      peerRegistry: new PeerRegistry(),
      capabilityRegistry: new MeshCapabilityRegistry(),
      localDeviceId: "local-123",
    });
    expect(handlers["mesh.peers"]).toBeDefined();
    expect(typeof handlers["mesh.peers"]).toBe("function");
  });

  it("mesh.peers returns empty when no peers connected", () => {
    const handlers = createMeshPeersHandlers({
      peerRegistry: new PeerRegistry(),
      capabilityRegistry: new MeshCapabilityRegistry(),
      localDeviceId: "local-123",
    });

    let response: any;
    handlers["mesh.peers"]({
      params: {},
      respond: (ok: boolean, payload?: any) => { response = { ok, payload }; },
    } as any);
    expect(response.ok).toBe(true);
  });
});

// ─── context.sync handler ───────────────────────────

describe("createContextSyncHandlers - expanded", () => {
  it("returns handler for context.sync", () => {
    const wm = new WorldModel({ log: { info: () => {} } });
    const handlers = createContextSyncHandlers({ worldModel: wm });
    expect(handlers["context.sync"]).toBeDefined();
  });

  it("context.sync responds with frames", () => {
    const wm = new WorldModel({ log: { info: () => {} } });
    const handlers = createContextSyncHandlers({ worldModel: wm });

    let response: any;
    handlers["context.sync"]({
      params: { since: 0 },
      respond: (ok: boolean, payload?: any) => { response = { ok, payload }; },
    });
    expect(response.ok).toBe(true);
    expect(response.payload.frames).toBeDefined();
  });

  it("context.sync filters by since timestamp", () => {
    const wm = new WorldModel({ log: { info: () => {} } });
    wm.ingest({
      kind: "observation",
      frameId: "old-frame",
      sourceDeviceId: "dev",
      timestamp: 1000,
      data: { metric: "m", value: 1 },
      trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T1_unverified_observation" },
    });

    const handlers = createContextSyncHandlers({ worldModel: wm });

    let response: any;
    handlers["context.sync"]({
      params: { since: Date.now() },  // future timestamp
      respond: (ok: boolean, payload?: any) => { response = { ok, payload }; },
    });
    expect(response.ok).toBe(true);
    expect(response.payload.frames.length).toBe(0);
  });
});

// ─── Capability registry expanded ───────────────────

describe("MeshCapabilityRegistry - additional edge cases", () => {
  it("findPeersWithCapability returns all matches", () => {
    const reg = new MeshCapabilityRegistry();
    reg.updatePeer("p1", ["channel:telegram"]);
    reg.updatePeer("p2", ["channel:telegram", "sensor:moisture"]);
    reg.updatePeer("p3", ["sensor:moisture"]);
    expect(reg.findPeersWithCapability("channel:telegram")).toEqual(["p1", "p2"]);
  });

  it("listAll returns all peers", () => {
    const reg = new MeshCapabilityRegistry();
    reg.updatePeer("p1", ["a"]);
    reg.updatePeer("p2", ["b", "c"]);
    const all = reg.listAll();
    expect(all).toHaveLength(2);
    expect(all.find(p => p.deviceId === "p2")?.capabilities).toContain("b");
  });

  it("updatePeer with empty capabilities", () => {
    const reg = new MeshCapabilityRegistry();
    reg.updatePeer("p1", []);
    expect(reg.getPeerCapabilities("p1")).toEqual([]);
  });

  it("findPeerWithChannel returns null when not found", () => {
    const reg = new MeshCapabilityRegistry();
    reg.updatePeer("p1", ["sensor:moisture"]);
    expect(reg.findPeerWithChannel("telegram")).toBeNull();
  });
});
