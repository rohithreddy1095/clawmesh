import { describe, expect, it, beforeEach } from "vitest";
import { MeshCapabilityRegistry } from "./capabilities.js";
import { resolveMeshRoute } from "./routing.js";

describe("resolveMeshRoute (ClawMesh decoupled routing)", () => {
  let registry: MeshCapabilityRegistry;

  beforeEach(() => {
    registry = new MeshCapabilityRegistry();
  });

  it("returns local when channel is in local capabilities", () => {
    const result = resolveMeshRoute({
      channel: "telegram",
      capabilityRegistry: registry,
      localCapabilities: new Set(["channel:telegram"]),
    });
    expect(result).toEqual({ kind: "local" });
  });

  it("returns mesh when a peer has the channel capability", () => {
    registry.updatePeer("peer-abc", ["channel:telegram"]);
    const result = resolveMeshRoute({
      channel: "telegram",
      capabilityRegistry: registry,
    });
    expect(result).toEqual({ kind: "mesh", peerDeviceId: "peer-abc" });
  });

  it("returns unavailable when no one has the channel", () => {
    const result = resolveMeshRoute({
      channel: "telegram",
      capabilityRegistry: registry,
    });
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("prefers local over mesh (local-first routing)", () => {
    registry.updatePeer("peer-abc", ["channel:telegram"]);
    const result = resolveMeshRoute({
      channel: "telegram",
      capabilityRegistry: registry,
      localCapabilities: new Set(["channel:telegram"]),
    });
    expect(result).toEqual({ kind: "local" });
  });

  it("returns first mesh peer match when multiple peers have the channel", () => {
    registry.updatePeer("peer-aaa", ["channel:telegram"]);
    registry.updatePeer("peer-bbb", ["channel:telegram"]);
    const result = resolveMeshRoute({
      channel: "telegram",
      capabilityRegistry: registry,
    });
    expect(result.kind).toBe("mesh");
    if (result.kind === "mesh") {
      expect(["peer-aaa", "peer-bbb"]).toContain(result.peerDeviceId);
    }
  });

  it("handles empty local capabilities set", () => {
    registry.updatePeer("peer-abc", ["channel:slack"]);
    const result = resolveMeshRoute({
      channel: "slack",
      capabilityRegistry: registry,
      localCapabilities: new Set(),
    });
    expect(result).toEqual({ kind: "mesh", peerDeviceId: "peer-abc" });
  });

  it("does not match wrong channel prefix", () => {
    const result = resolveMeshRoute({
      channel: "telegram",
      capabilityRegistry: registry,
      localCapabilities: new Set(["skill:telegram"]),
    });
    expect(result).toEqual({ kind: "unavailable" });
  });
});
