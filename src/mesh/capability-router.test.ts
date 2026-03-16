import { describe, it, expect, beforeEach } from "vitest";
import { resolveCapabilityRoute, findAllCapabilityPeers, type PeerHealthMap } from "./capability-router.js";
import { MeshCapabilityRegistry } from "./capabilities.js";

describe("resolveCapabilityRoute", () => {
  let registry: MeshCapabilityRegistry;

  beforeEach(() => {
    registry = new MeshCapabilityRegistry();
  });

  it("returns local when capability is available locally", () => {
    const result = resolveCapabilityRoute({
      capability: "actuator:pump:P1",
      capabilityRegistry: registry,
      localCapabilities: new Set(["actuator:pump:P1"]),
    });
    expect(result.kind).toBe("local");
  });

  it("returns local for wildcard match", () => {
    const result = resolveCapabilityRoute({
      capability: "actuator:*",
      capabilityRegistry: registry,
      localCapabilities: new Set(["actuator:pump:P1"]),
    });
    expect(result.kind).toBe("local");
  });

  it("returns mesh peer when not local", () => {
    registry.updatePeer("jetson-1", ["actuator:pump:P1"]);

    const result = resolveCapabilityRoute({
      capability: "actuator:pump:P1",
      capabilityRegistry: registry,
    });
    expect(result.kind).toBe("mesh");
    if (result.kind === "mesh") {
      expect(result.peerDeviceId).toBe("jetson-1");
      expect(result.score).toBeGreaterThan(0);
    }
  });

  it("returns unavailable when no one has the capability", () => {
    const result = resolveCapabilityRoute({
      capability: "actuator:pump:P1",
      capabilityRegistry: registry,
    });
    expect(result.kind).toBe("unavailable");
  });

  it("prefers healthy peer over unhealthy for same capability", () => {
    registry.updatePeer("jetson-healthy", ["actuator:pump:P1"]);
    registry.updatePeer("jetson-sick", ["actuator:pump:P1"]);

    const peerHealth: PeerHealthMap = new Map();
    peerHealth.set("jetson-healthy", new Map([["actuator:pump:P1", "healthy" as const]]));
    peerHealth.set("jetson-sick", new Map([["actuator:pump:P1", "unhealthy" as const]]));

    const result = resolveCapabilityRoute({
      capability: "actuator:pump:P1",
      capabilityRegistry: registry,
      peerHealth,
    });

    expect(result.kind).toBe("mesh");
    if (result.kind === "mesh") {
      expect(result.peerDeviceId).toBe("jetson-healthy");
    }
  });

  it("prefers exact match over wildcard match", () => {
    registry.updatePeer("peer-exact", ["actuator:pump:P1"]);
    registry.updatePeer("peer-generic", ["actuator:pump:P2"]);

    const result = resolveCapabilityRoute({
      capability: "actuator:pump:P1",
      capabilityRegistry: registry,
    });

    expect(result.kind).toBe("mesh");
    if (result.kind === "mesh") {
      expect(result.peerDeviceId).toBe("peer-exact");
    }
  });

  it("matches with wildcard pattern in request", () => {
    registry.updatePeer("jetson", ["actuator:pump:P1", "actuator:valve:V1"]);

    const result = resolveCapabilityRoute({
      capability: "actuator:pump:*",
      capabilityRegistry: registry,
    });

    expect(result.kind).toBe("mesh");
    if (result.kind === "mesh") {
      expect(result.peerDeviceId).toBe("jetson");
    }
  });
});

describe("findAllCapabilityPeers", () => {
  let registry: MeshCapabilityRegistry;

  beforeEach(() => {
    registry = new MeshCapabilityRegistry();
  });

  it("returns empty for no matches", () => {
    const peers = findAllCapabilityPeers({
      capability: "sensor:temp",
      capabilityRegistry: registry,
    });
    expect(peers).toHaveLength(0);
  });

  it("returns all matching peers sorted by score", () => {
    registry.updatePeer("peer-1", ["actuator:pump:P1"]);
    registry.updatePeer("peer-2", ["actuator:pump:P2"]);

    const peerHealth: PeerHealthMap = new Map();
    peerHealth.set("peer-1", new Map([["actuator:pump:P1", "healthy" as const]]));
    peerHealth.set("peer-2", new Map([["actuator:pump:P2", "degraded" as const]]));

    const peers = findAllCapabilityPeers({
      capability: "actuator:pump:*",
      capabilityRegistry: registry,
      peerHealth,
    });

    expect(peers).toHaveLength(2);
    // Healthy peer should be first
    expect(peers[0].peerDeviceId).toBe("peer-1");
    expect(peers[0].score).toBeGreaterThan(peers[1].score);
  });

  it("returns one entry per peer even with multiple matching caps", () => {
    registry.updatePeer("multi-cap", ["actuator:pump:P1", "actuator:pump:P2"]);

    const peers = findAllCapabilityPeers({
      capability: "actuator:pump:*",
      capabilityRegistry: registry,
    });

    expect(peers).toHaveLength(1);
  });
});
