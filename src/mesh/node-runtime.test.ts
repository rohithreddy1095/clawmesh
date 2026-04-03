import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildLlmOnlyActuationTrust } from "./node-runtime.js";
import { MeshRuntimeHarness } from "./test-helpers.js";

vi.mock("@homebridge/ciao", () => {
  const browser = {
    on: vi.fn(),
    start: vi.fn(),
  };
  const service = {
    advertise: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
  };
  const responder = {
    createService: vi.fn(() => service),
    createServiceBrowser: vi.fn(() => browser),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
  return {
    default: {
      getResponder: vi.fn(() => responder),
    },
  };
});

describe("MeshNodeRuntime", () => {
  let harness: MeshRuntimeHarness;

  beforeEach(async () => {
    harness = new MeshRuntimeHarness();
    await harness.setup();
  });

  afterEach(async () => {
    await harness.teardown();
  });

  it("connects two nodes and applies a trusted mock actuator command end-to-end", async () => {
    const nodeB = await harness.startNode({
      name: "node-b",
      enableMockActuator: true,
      capabilities: ["channel:clawmesh", "actuator:mock"],
    });
    const nodeA = await harness.startNode({
      name: "node-a",
      capabilities: ["channel:clawmesh"],
    });

    if (!nodeA || !nodeB) return;

    const connected = await harness.connect(nodeA, nodeB);
    expect(connected).toBe(true);

    const forward = await nodeA.runtime.sendMockActuation({
      peerDeviceId: nodeB.identity.deviceId,
      targetRef: "actuator:mock:valve-1",
      operation: "open",
      operationParams: { durationSec: 45 },
      note: "runtime test",
    });
    expect(forward.ok).toBe(true);

    const state = await nodeA.runtime.queryPeerMockActuatorState({
      peerDeviceId: nodeB.identity.deviceId,
      targetRef: "actuator:mock:valve-1",
    });

    expect(state.ok).toBe(true);
    const payload = state.payload as {
      records: Array<{ targetRef: string; status: string; lastOperation?: string }>;
    };
    expect(payload.records).toHaveLength(1);
    expect(payload.records[0]).toMatchObject({
      targetRef: "actuator:mock:valve-1",
      status: "active",
      lastOperation: "open",
    });
  });

  it("rejects llm-only actuation in runtime mesh flow", async () => {
    const nodeB = await harness.startNode({
      name: "node-b2",
      enableMockActuator: true,
      capabilities: ["channel:clawmesh", "actuator:mock"],
    });
    const nodeA = await harness.startNode({
      name: "node-a2",
      capabilities: ["channel:clawmesh"],
    });

    if (!nodeA || !nodeB) return;

    const connected = await harness.connect(nodeA, nodeB);
    expect(connected).toBe(true);

    const forward = await nodeA.runtime.sendMockActuation({
      peerDeviceId: nodeB.identity.deviceId,
      targetRef: "actuator:mock:pump-1",
      operation: "start",
      trust: buildLlmOnlyActuationTrust(),
    });

    expect(forward.ok).toBe(false);
    expect(forward.error).toContain("LLM_ONLY_ACTUATION_BLOCKED");

    const state = await nodeA.runtime.queryPeerMockActuatorState({
      peerDeviceId: nodeB.identity.deviceId,
      targetRef: "actuator:mock:pump-1",
    });
    expect(state.ok).toBe(true);
    const payload = state.payload as { records: unknown[] };
    expect(payload.records).toHaveLength(0);
  });

  it("rejects actuation with insufficient trust tier at sender", async () => {
    const nodeB = await harness.startNode({
      name: "node-b3",
      enableMockActuator: true,
      capabilities: ["channel:clawmesh", "actuator:mock"],
    });
    const nodeA = await harness.startNode({
      name: "node-a3",
      capabilities: ["channel:clawmesh"],
    });

    if (!nodeA || !nodeB) return;

    const connected = await harness.connect(nodeA, nodeB);
    expect(connected).toBe(true);

    const forward = await nodeA.runtime.sendMockActuation({
      peerDeviceId: nodeB.identity.deviceId,
      targetRef: "actuator:mock:pump-1",
      operation: "start",
      trust: {
        action_type: "actuation",
        evidence_sources: ["sensor"],
        evidence_trust_tier: "T1_unverified_observation",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "none",
      },
    });

    expect(forward.ok).toBe(false);
    expect(forward.error).toContain("INSUFFICIENT_TRUST_TIER");
  });

  it("rejects actuation with unsatisfied verification at sender", async () => {
    const nodeB = await harness.startNode({
      name: "node-b4",
      enableMockActuator: true,
      capabilities: ["channel:clawmesh", "actuator:mock"],
    });
    const nodeA = await harness.startNode({
      name: "node-a4",
      capabilities: ["channel:clawmesh"],
    });

    if (!nodeA || !nodeB) return;

    const connected = await harness.connect(nodeA, nodeB);
    expect(connected).toBe(true);

    const forward = await nodeA.runtime.sendMockActuation({
      peerDeviceId: nodeB.identity.deviceId,
      targetRef: "actuator:mock:pump-1",
      operation: "start",
      trust: {
        action_type: "actuation",
        evidence_sources: ["sensor", "human"],
        evidence_trust_tier: "T3_verified_action_evidence",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "human",
      },
    });

    expect(forward.ok).toBe(false);
    expect(forward.error).toContain("VERIFICATION_REQUIRED");
  });

  it("emits peer.disconnected with 'peer leaving' when a remote node stops gracefully", async () => {
    const nodeB = await harness.startNode({
      name: "node-b5",
      capabilities: ["channel:clawmesh"],
    });
    const nodeA = await harness.startNode({
      name: "node-a5",
      capabilities: ["channel:clawmesh"],
    });

    if (!nodeA || !nodeB) return;

    const connected = await harness.connect(nodeA, nodeB);
    expect(connected).toBe(true);

    const disconnected = new Promise<{ deviceId: string; reason?: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for peer.disconnected")), 2_000);
      nodeA.runtime.eventBus.on("peer.disconnected", (event) => {
        if (event.deviceId === nodeB.identity.deviceId) {
          clearTimeout(timer);
          resolve(event);
        }
      });
    });

    await nodeB.runtime.stop();

    const event = await disconnected;
    expect(event.reason).toBe("peer leaving");
    expect(nodeA.runtime.listConnectedPeers().some((p) => p.deviceId === nodeB.identity.deviceId)).toBe(false);
  });

  it("does not connect peers from different mesh IDs", async () => {
    const nodeB = await harness.startNode({
      name: "node-b6",
      meshId: "mesh-b",
      capabilities: ["channel:clawmesh"],
    });
    const nodeA = await harness.startNode({
      name: "node-a6",
      meshId: "mesh-a",
      capabilities: ["channel:clawmesh"],
    });

    if (!nodeA || !nodeB) return;

    await harness.trust(nodeA, nodeB);
    nodeA.runtime.connectToPeer({
      deviceId: nodeB.identity.deviceId,
      url: harness.urlFor(nodeB),
    });

    const connected = await nodeA.runtime.waitForPeerConnected(nodeB.identity.deviceId, 500);
    expect(connected).toBe(false);
    expect(nodeA.runtime.listConnectedPeers()).toHaveLength(0);
    expect(nodeB.runtime.listConnectedPeers()).toHaveLength(0);
  });

  it("propagates declared node roles across a successful connection", async () => {
    const nodeB = await harness.startNode({
      name: "node-b7",
      role: "field",
      capabilities: ["channel:clawmesh"],
    });
    const nodeA = await harness.startNode({
      name: "node-a7",
      role: "planner",
      capabilities: ["channel:clawmesh"],
    });

    if (!nodeA || !nodeB) return;

    const connected = await harness.connect(nodeA, nodeB);
    expect(connected).toBe(true);

    const peerSeenByA = nodeA.runtime.listConnectedPeers().find((p) => p.deviceId === nodeB.identity.deviceId);
    const peerSeenByB = nodeB.runtime.listConnectedPeers().find((p) => p.deviceId === nodeA.identity.deviceId);

    expect(peerSeenByA?.role).toBe("field");
    expect(peerSeenByB?.role).toBe("planner");
  });

  it("allows viewer peers to connect without contributing capabilities to routing", async () => {
    const viewer = await harness.startNode({
      name: "viewer-1",
      role: "viewer",
      capabilities: ["channel:telegram"],
    });
    const planner = await harness.startNode({
      name: "planner-1",
      role: "planner",
      capabilities: ["channel:clawmesh"],
    });

    if (!viewer || !planner) return;

    const connected = await harness.connect(planner, viewer);
    expect(connected).toBe(true);

    const peerSeenByPlanner = planner.runtime.listConnectedPeers().find((p) => p.deviceId === viewer.identity.deviceId);
    expect(peerSeenByPlanner?.role).toBe("viewer");
    expect(planner.runtime.capabilityRegistry.findPeerWithChannel("telegram")).toBe(null);
    expect(planner.runtime.capabilityRegistry.getPeerCapabilities(viewer.identity.deviceId)).toEqual([]);
  });

  it("reports standby planner activity when a higher-priority planner peer is connected", async () => {
    const leader = await harness.startNode({
      name: "planner-leader",
      role: "planner",
      capabilities: ["channel:clawmesh"],
    });
    const standby = await harness.startNode({
      name: "planner-standby",
      role: "standby-planner",
      capabilities: ["channel:clawmesh"],
    });

    if (!leader || !standby) return;

    const connected = await harness.connect(standby, leader);
    expect(connected).toBe(true);

    expect(standby.runtime.getPlannerActivity()).toMatchObject({
      state: "standby",
      shouldHandleAutonomous: false,
      leader: { kind: "peer", deviceId: leader.identity.deviceId, role: "planner" },
    });
    expect(leader.runtime.getPlannerActivity()).toMatchObject({
      state: "active",
      shouldHandleAutonomous: true,
      leader: { kind: "local", deviceId: leader.identity.deviceId, role: "planner" },
    });
  });

  it("can start with discovery disabled for static or relay-only deployments", async () => {
    const node = await harness.startNode({
      name: "static-only-node",
      disableDiscovery: true,
      capabilities: ["channel:clawmesh"],
    });

    if (!node) return;

    expect(node.runtime.discovery).toBeUndefined();
  });

  it("normalizes configured static peer urls at runtime boundary", async () => {
    const node = await harness.startNode({
      name: "static-normalize-node",
      disableDiscovery: true,
      staticPeers: [{
        deviceId: "peer-relay",
        url: "https://relay.example.com/mesh",
        transportLabel: "relay",
      }],
      capabilities: ["channel:clawmesh"],
    });

    if (!node) return;

    expect(node.runtime.getConfiguredStaticPeers()[0]?.url).toBe("wss://relay.example.com/mesh");
    expect(node.runtime.getConfiguredStaticPeers()[0]?.transportLabel).toBe("relay");
    expect(node.runtime.getConfiguredStaticPeers()[0]?.securityPosture).toBe("tls-unpinned");
  });

  it("labels auto-connected discovery peers as mdns", async () => {
    const nodeB = await harness.startNode({
      name: "node-b-mdns",
      capabilities: ["channel:clawmesh"],
    });
    const nodeA = await harness.startNode({
      name: "node-a-mdns",
      capabilities: ["channel:clawmesh"],
    });

    if (!nodeA || !nodeB || !nodeA.runtime.discovery) return;

    await harness.trust(nodeA, nodeB);
    nodeA.runtime.discovery.emit("peer-discovered", {
      deviceId: nodeB.identity.deviceId,
      displayName: nodeB.runtime.displayName,
      host: "127.0.0.1",
      port: nodeB.address.port,
      discoveredAtMs: Date.now(),
    });

    const connected = await nodeA.runtime.waitForPeerConnected(nodeB.identity.deviceId, 2_000);
    expect(connected).toBe(true);

    const peerSeenByA = nodeA.runtime.listConnectedPeers().find((p) => p.deviceId === nodeB.identity.deviceId);
    expect(peerSeenByA?.transportLabel).toBe("mdns");
  });
});
