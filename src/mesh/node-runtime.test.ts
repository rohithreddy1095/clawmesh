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
});
