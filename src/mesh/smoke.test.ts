import { describe, expect, it } from "vitest";

describe("ClawMesh smoke test", () => {
  it("imports MeshManager cleanly", async () => {
    const mod = await import("./manager.js");
    expect(mod.MeshManager).toBeDefined();
    expect(typeof mod.MeshManager).toBe("function");
  });

  it("imports MeshCapabilityRegistry cleanly", async () => {
    const mod = await import("./capabilities.js");
    expect(mod.MeshCapabilityRegistry).toBeDefined();
  });

  it("imports PeerRegistry cleanly", async () => {
    const mod = await import("./peer-registry.js");
    expect(mod.PeerRegistry).toBeDefined();
  });

  it("imports MeshDiscovery cleanly", async () => {
    const mod = await import("./discovery.js");
    expect(mod.MeshDiscovery).toBeDefined();
  });

  it("imports handshake functions cleanly", async () => {
    const mod = await import("./handshake.js");
    expect(mod.buildMeshConnectAuth).toBeDefined();
    expect(mod.verifyMeshConnectAuth).toBeDefined();
  });

  it("imports peer trust functions cleanly", async () => {
    const mod = await import("./peer-trust.js");
    expect(mod.addTrustedPeer).toBeDefined();
    expect(mod.isTrustedPeer).toBeDefined();
    expect(mod.listTrustedPeers).toBeDefined();
  });

  it("imports forwarding cleanly", async () => {
    const mod = await import("./forwarding.js");
    expect(mod.forwardMessageToPeer).toBeDefined();
  });

  it("imports routing cleanly", async () => {
    const mod = await import("./routing.js");
    expect(mod.resolveMeshRoute).toBeDefined();
  });
});
