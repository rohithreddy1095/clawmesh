/**
 * Expanded coverage tests for modules with thin test suites.
 * Adds edge case tests to peer-registry, event-bus, transport, and context-propagator.
 */

import { describe, it, expect, vi } from "vitest";
import { PeerRegistry } from "./peer-registry.js";
import { MeshEventBus } from "./event-bus.js";
import { MockTransport, WebSocketTransport, TransportState } from "./transport.js";
import { MeshCapabilityRegistry } from "./capabilities.js";
import { TrustAuditTrail } from "./trust-audit.js";
import { RpcDispatcher } from "./rpc-dispatcher.js";
import { UIBroadcaster } from "./ui-broadcaster.js";
import { AutoConnectManager } from "./auto-connect.js";

// ─── PeerRegistry edge cases ────────────────────────

describe("PeerRegistry - expanded edge cases", () => {
  it("unregister returns null for unknown connId", () => {
    const reg = new PeerRegistry();
    expect(reg.unregister("unknown")).toBeNull();
  });

  it("get returns undefined for unknown deviceId", () => {
    const reg = new PeerRegistry();
    expect(reg.get("unknown")).toBeUndefined();
  });

  it("getByConnId returns undefined for unknown connId", () => {
    const reg = new PeerRegistry();
    expect(reg.getByConnId("unknown")).toBeUndefined();
  });

  it("listConnected returns empty initially", () => {
    const reg = new PeerRegistry();
    expect(reg.listConnected()).toEqual([]);
  });

  it("sendEvent returns false for unknown device", () => {
    const reg = new PeerRegistry();
    expect(reg.sendEvent("unknown", "test")).toBe(false);
  });

  it("handleRpcResult returns false for unknown request", () => {
    const reg = new PeerRegistry();
    expect(reg.handleRpcResult({ id: "unknown", ok: true })).toBe(false);
  });

  it("invoke returns NOT_CONNECTED for unknown peer", async () => {
    const reg = new PeerRegistry();
    const result = await reg.invoke({ deviceId: "unknown", method: "test" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_CONNECTED");
  });
});

// ─── MeshEventBus edge cases ────────────────────────

describe("MeshEventBus - expanded edge cases", () => {
  it("emit with no listeners does not throw", () => {
    const bus = new MeshEventBus();
    expect(() => bus.emit("peer.connected", { session: {} as any })).not.toThrow();
  });

  it("once listener only fires once", () => {
    const bus = new MeshEventBus();
    const fn = vi.fn();
    bus.once("runtime.started", fn);
    bus.emit("runtime.started", { host: "0.0.0.0", port: 1234 });
    bus.emit("runtime.started", { host: "0.0.0.0", port: 1234 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe prevents further calls", () => {
    const bus = new MeshEventBus();
    const fn = vi.fn();
    const unsub = bus.on("runtime.stopping", fn);
    bus.emit("runtime.stopping", {});
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    bus.emit("runtime.stopping", {});
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("multiple listeners for same event", () => {
    const bus = new MeshEventBus();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    bus.on("runtime.started", fn1);
    bus.on("runtime.started", fn2);
    bus.emit("runtime.started", { host: "x", port: 0 });
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });
});

// ─── MockTransport edge cases ───────────────────────

describe("MockTransport - expanded", () => {
  it("can be constructed", () => {
    const t = new MockTransport();
    expect(t).toBeDefined();
  });

  it("send does not throw", () => {
    const t = new MockTransport();
    expect(() => t.send("test message")).not.toThrow();
  });

  it("close is idempotent", () => {
    const t = new MockTransport();
    t.close();
    t.close(); // should not throw
  });
});

// ─── TransportState constants ───────────────────────

describe("TransportState", () => {
  it("has all expected states", () => {
    expect(TransportState.CONNECTING).toBeDefined();
    expect(TransportState.OPEN).toBeDefined();
    expect(TransportState.CLOSING).toBeDefined();
    expect(TransportState.CLOSED).toBeDefined();
  });

  it("states are distinct", () => {
    const states = new Set([
      TransportState.CONNECTING,
      TransportState.OPEN,
      TransportState.CLOSING,
      TransportState.CLOSED,
    ]);
    expect(states.size).toBe(4);
  });
});

// ─── MeshCapabilityRegistry edge cases ──────────────

describe("MeshCapabilityRegistry - expanded", () => {
  it("getPeerCapabilities returns empty for unknown peer", () => {
    const reg = new MeshCapabilityRegistry();
    expect(reg.getPeerCapabilities("unknown")).toEqual([]);
  });

  it("listAll returns empty initially", () => {
    expect(new MeshCapabilityRegistry().listAll()).toEqual([]);
  });

  it("updatePeer replaces existing capabilities", () => {
    const reg = new MeshCapabilityRegistry();
    reg.updatePeer("peer-1", ["sensor:moisture"]);
    reg.updatePeer("peer-1", ["actuator:pump"]);
    expect(reg.getPeerCapabilities("peer-1")).toEqual(["actuator:pump"]);
  });

  it("removePeer removes all capabilities", () => {
    const reg = new MeshCapabilityRegistry();
    reg.updatePeer("peer-1", ["sensor:moisture", "actuator:pump"]);
    reg.removePeer("peer-1");
    expect(reg.getPeerCapabilities("peer-1")).toEqual([]);
  });

  it("findPeerWithSkill works", () => {
    const reg = new MeshCapabilityRegistry();
    reg.updatePeer("peer-1", ["skill:planning"]);
    expect(reg.findPeerWithSkill("planning")).toBe("peer-1");
    expect(reg.findPeerWithSkill("unknown")).toBeNull();
  });
});

// ─── TrustAuditTrail edge cases ─────────────────────

describe("TrustAuditTrail - expanded", () => {
  it("starts empty", () => {
    const trail = new TrustAuditTrail();
    expect(trail.query({})).toEqual([]);
  });

  it("records and retrieves entries", () => {
    const trail = new TrustAuditTrail();
    trail.record(
      {
        channel: "clawmesh",
        to: "peer-1",
        originGatewayId: "gw-1",
        trust: {
          action_type: "actuation",
          evidence_sources: ["sensor"],
          evidence_trust_tier: "T3_verified_action_evidence",
          minimum_trust_tier: "T2_operational_observation",
          verification_required: "human",
          verification_satisfied: true,
        },
      } as any,
      { ok: true },
    );
    const entries = trail.query({});
    expect(entries).toHaveLength(1);
    expect(entries[0].ok).toBe(true);
  });

  it("statistics returns correct counts", () => {
    const trail = new TrustAuditTrail();
    const payload = {
      channel: "clawmesh",
      to: "p",
      originGatewayId: "g",
      trust: { action_type: "actuation", evidence_sources: ["sensor"], evidence_trust_tier: "T3_verified_action_evidence", minimum_trust_tier: "T2_operational_observation", verification_required: "human" },
    } as any;
    trail.record(payload, { ok: true });
    trail.record(payload, { ok: false, code: "DENIED", message: "denied" });
    trail.record({ ...payload, channel: "other" }, { ok: true });
    const stats = trail.getStats();
    expect(stats.total).toBe(3);
    expect(stats.approved).toBe(2);
    expect(stats.rejected).toBe(1);
  });
});

// ─── RpcDispatcher edge cases ───────────────────────

describe("RpcDispatcher - expanded", () => {
  it("listMethods returns empty initially", () => {
    const rpc = new RpcDispatcher();
    expect(rpc.listMethods()).toEqual([]);
  });

  it("register adds method to list", () => {
    const rpc = new RpcDispatcher();
    rpc.register("test.method", () => {});
    expect(rpc.listMethods()).toContain("test.method");
  });

  it("registerAll adds multiple methods", () => {
    const rpc = new RpcDispatcher();
    rpc.registerAll({
      "m1": () => {},
      "m2": () => {},
    });
    expect(rpc.listMethods()).toContain("m1");
    expect(rpc.listMethods()).toContain("m2");
  });
});

// ─── UIBroadcaster edge cases ───────────────────────

describe("UIBroadcaster - expanded", () => {
  it("broadcast with no subscribers does not throw", () => {
    const ui = new UIBroadcaster();
    expect(() => ui.broadcast("test", {})).not.toThrow();
  });

  it("subscriberCount returns 0 initially", () => {
    const ui = new UIBroadcaster();
    expect(ui.subscriberCount).toBe(0);
  });
});

// ─── AutoConnectManager edge cases ──────────────────

describe("AutoConnectManager - expanded", () => {
  it("can be constructed", () => {
    const acm = new AutoConnectManager();
    expect(acm).toBeDefined();
  });

  it("reset does not throw", () => {
    const acm = new AutoConnectManager();
    expect(() => acm.reset()).not.toThrow();
  });
});
