import { describe, it, expect, beforeEach, vi } from "vitest";
import { ContextPropagator } from "./context-propagator.js";
import { PeerRegistry } from "./peer-registry.js";
import type { DeviceIdentity } from "../infra/device-identity.js";
import type { ContextFrame } from "./context-types.js";

const noop = { info: () => {} };

const fakeIdentity: DeviceIdentity = {
  deviceId: "local-device-id-abc123",
  publicKeyPem: "fake-public-key",
  privateKeyPem: "fake-private-key",
};

function makeFrame(overrides?: Partial<ContextFrame>): ContextFrame {
  return {
    kind: "observation",
    frameId: `frame-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "remote-device-xyz",
    sourceDisplayName: "remote-node",
    timestamp: Date.now(),
    data: { metric: "soil_moisture", value: 25, zone: "zone-1" },
    trust: {
      evidence_sources: ["sensor"],
      evidence_trust_tier: "T2_operational_observation",
    },
    hops: 0,
    ...overrides,
  };
}

describe("ContextPropagator", () => {
  let peerRegistry: PeerRegistry;
  let propagator: ContextPropagator;

  beforeEach(() => {
    peerRegistry = new PeerRegistry();
    propagator = new ContextPropagator({
      identity: fakeIdentity,
      peerRegistry,
      displayName: "test-local",
      log: noop,
    });
  });

  // ─── broadcast ─────────────────────────────

  it("broadcast creates a full context frame with local deviceId", () => {
    const frame = propagator.broadcast({
      kind: "observation",
      data: { metric: "temp", value: 30 },
      trust: {
        evidence_sources: ["sensor"],
        evidence_trust_tier: "T2_operational_observation",
      },
    });

    expect(frame.sourceDeviceId).toBe(fakeIdentity.deviceId);
    expect(frame.sourceDisplayName).toBe("test-local");
    expect(frame.hops).toBe(0);
    expect(frame.frameId).toBeTruthy();
    expect(frame.timestamp).toBeGreaterThan(0);
  });

  it("broadcast calls onLocalBroadcast callback", () => {
    const callback = vi.fn();
    propagator.onLocalBroadcast = callback;

    propagator.broadcast({
      kind: "observation",
      data: { metric: "test", value: 1 },
      trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    });

    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0].kind).toBe("observation");
  });

  it("broadcastObservation creates observation frame with T2 trust", () => {
    const frame = propagator.broadcastObservation({
      data: { metric: "moisture", value: 30, zone: "z1" },
    });

    expect(frame.kind).toBe("observation");
    expect(frame.trust.evidence_trust_tier).toBe("T2_operational_observation");
    expect(frame.trust.evidence_sources).toContain("sensor");
  });

  it("broadcastHumanInput creates human_input frame with T3 trust", () => {
    const frame = propagator.broadcastHumanInput({
      data: { intent: "check zone-1" },
    });

    expect(frame.kind).toBe("human_input");
    expect(frame.trust.evidence_trust_tier).toBe("T3_verified_action_evidence");
    expect(frame.trust.evidence_sources).toContain("human");
  });

  it("broadcastInference creates inference frame with T0 trust", () => {
    const frame = propagator.broadcastInference({
      data: { reasoning: "Zone-1 needs irrigation" },
    });

    expect(frame.kind).toBe("inference");
    expect(frame.trust.evidence_trust_tier).toBe("T0_planning_inference");
    expect(frame.trust.evidence_sources).toContain("llm");
  });

  it("broadcastAgentResponse creates agent_response frame", () => {
    const frame = propagator.broadcastAgentResponse({
      data: { message: "I recommend irrigating zone-1" },
    });

    expect(frame.kind).toBe("agent_response");
    expect(frame.trust.evidence_trust_tier).toBe("T0_planning_inference");
  });

  // ─── handleInbound ─────────────────────────

  it("handleInbound returns true for new frames", () => {
    const frame = makeFrame();
    const isNew = propagator.handleInbound(frame, "remote-device-xyz");
    expect(isNew).toBe(true);
  });

  it("handleInbound returns false for duplicate frames", () => {
    const frame = makeFrame({ frameId: "dup-123" });
    propagator.handleInbound(frame, "remote-device-xyz");
    const isDup = propagator.handleInbound(frame, "remote-device-xyz");
    expect(isDup).toBe(false);
  });

  it("handleInbound rejects frames from self", () => {
    const frame = makeFrame({ sourceDeviceId: fakeIdentity.deviceId });
    const isNew = propagator.handleInbound(frame, "some-peer");
    expect(isNew).toBe(false);
  });

  it("handleInbound increments hop count on re-propagation", () => {
    // Register a second peer to receive gossip
    const sentEvents: string[] = [];
    const mockSocket = {
      readyState: 1,
      send: (data: string) => sentEvents.push(data),
    };
    peerRegistry.register({
      deviceId: "peer-B",
      connId: "conn-B",
      socket: mockSocket as any,
      outbound: false,
      capabilities: [],
      connectedAtMs: Date.now(),
    });

    const frame = makeFrame({ hops: 1 });
    propagator.handleInbound(frame, "peer-A");

    // Frame should have been re-propagated to peer-B
    expect(sentEvents).toHaveLength(1);
    const forwarded = JSON.parse(sentEvents[0]);
    expect(forwarded.event).toBe("context.frame");
    expect(forwarded.payload.hops).toBe(2);
  });

  it("handleInbound does NOT re-propagate frames at max hops", () => {
    const sentEvents: string[] = [];
    const mockSocket = {
      readyState: 1,
      send: (data: string) => sentEvents.push(data),
    };
    peerRegistry.register({
      deviceId: "peer-B",
      connId: "conn-B",
      socket: mockSocket as any,
      outbound: false,
      capabilities: [],
      connectedAtMs: Date.now(),
    });

    const frame = makeFrame({ hops: 3 }); // MAX_GOSSIP_HOPS = 3
    propagator.handleInbound(frame, "peer-A");

    // Should NOT re-propagate since we're at max hops
    expect(sentEvents).toHaveLength(0);
  });

  it("handleInbound does NOT forward back to sender", () => {
    const sentToA: string[] = [];
    const sentToB: string[] = [];

    peerRegistry.register({
      deviceId: "peer-A",
      connId: "conn-A",
      socket: { readyState: 1, send: (data: string) => sentToA.push(data) } as any,
      outbound: false,
      capabilities: [],
      connectedAtMs: Date.now(),
    });
    peerRegistry.register({
      deviceId: "peer-B",
      connId: "conn-B",
      socket: { readyState: 1, send: (data: string) => sentToB.push(data) } as any,
      outbound: false,
      capabilities: [],
      connectedAtMs: Date.now(),
    });

    const frame = makeFrame({ hops: 0 });
    propagator.handleInbound(frame, "peer-A");

    // Should forward to peer-B but NOT back to peer-A
    expect(sentToA).toHaveLength(0);
    expect(sentToB).toHaveLength(1);
  });

  // ─── Seen ID trimming ─────────────────────

  it("trims seen IDs when exceeding maxSeenIds", () => {
    const smallPropagator = new ContextPropagator({
      identity: fakeIdentity,
      peerRegistry,
      log: noop,
      maxSeenIds: 10,
    });

    // Generate 15 unique frames
    for (let i = 0; i < 15; i++) {
      smallPropagator.handleInbound(
        makeFrame({ frameId: `frame-${i}` }),
        "remote-peer",
      );
    }

    // The first few frames should have been trimmed from seenIds
    // but frame-14 should still be tracked (duplicate detection)
    const isDup = smallPropagator.handleInbound(
      makeFrame({ frameId: "frame-14" }),
      "remote-peer",
    );
    expect(isDup).toBe(false); // Still tracked
  });
});
