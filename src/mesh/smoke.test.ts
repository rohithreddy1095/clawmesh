import { describe, expect, it } from "vitest";

describe("ClawMesh smoke test", () => {
  it("imports MeshNodeRuntime cleanly", async () => {
    const mod = await import("./node-runtime.js");
    expect(mod.MeshNodeRuntime).toBeDefined();
    expect(typeof mod.MeshNodeRuntime).toBe("function");
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

  it("imports trust policy cleanly", async () => {
    const mod = await import("./trust-policy.js");
    expect(mod.evaluateMeshForwardTrust).toBeDefined();
  });

  it("imports world model cleanly", async () => {
    const mod = await import("./world-model.js");
    expect(mod.WorldModel).toBeDefined();
  });

  it("imports context propagator cleanly", async () => {
    const mod = await import("./context-propagator.js");
    expect(mod.ContextPropagator).toBeDefined();
  });

  it("imports PiSession cleanly", async () => {
    const mod = await import("../agents/pi-session.js");
    expect(mod.PiSession).toBeDefined();
    expect(typeof mod.PiSession).toBe("function");
  });

  it("imports ClawMesh extension factory cleanly", async () => {
    const mod = await import("../agents/extensions/clawmesh-mesh-extension.js");
    expect(mod.createClawMeshExtension).toBeDefined();
    expect(typeof mod.createClawMeshExtension).toBe("function");
  });

  it("imports farm context loader cleanly", async () => {
    const mod = await import("../agents/farm-context-loader.js");
    expect(mod.loadBhoomiContext).toBeDefined();
    expect(typeof mod.loadBhoomiContext).toBe("function");
  });
});
