/**
 * Extended ContextPropagator tests — edge cases and advanced scenarios.
 */

import { describe, it, expect } from "vitest";
import { ContextPropagator } from "../mesh/context-propagator.js";
import type { ContextFrame } from "../mesh/context-types.js";
import { PeerRegistry } from "../mesh/peer-registry.js";
import type { DeviceIdentity } from "../infra/device-identity.js";

function makeTestPropagator() {
  const registry = new PeerRegistry();
  const identity = {
    deviceId: "test-device-01",
    publicKeyPem: "test-key",
    sign: async () => "sig",
    verify: async () => true,
  } as unknown as DeviceIdentity;
  const propagator = new ContextPropagator({
    identity,
    peerRegistry: registry,
    displayName: "Test Node",
    log: { info: () => {} },
  });
  return { propagator, registry };
}

describe("ContextPropagator broadcast variants", () => {
  it("broadcastInference creates inference frame", () => {
    const { propagator } = makeTestPropagator();
    const frame = propagator.broadcastInference({
      data: { reasoning: "Soil is dry, need irrigation" },
      note: "Test inference",
    });
    expect(frame.kind).toBe("inference");
    expect(frame.sourceDeviceId).toBe("test-device-01");
    expect(frame.data.reasoning).toBe("Soil is dry, need irrigation");
  });

  it("broadcast generates unique frameIds", () => {
    const { propagator } = makeTestPropagator();
    const f1 = propagator.broadcast({
      kind: "observation",
      data: { metric: "temp", value: 30 },
      trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    });
    const f2 = propagator.broadcast({
      kind: "observation",
      data: { metric: "temp", value: 31 },
      trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    });
    expect(f1.frameId).not.toBe(f2.frameId);
  });

  it("broadcast sets timestamp", () => {
    const before = Date.now();
    const { propagator } = makeTestPropagator();
    const frame = propagator.broadcast({
      kind: "event",
      data: { event: "test" },
      trust: { evidence_sources: [], evidence_trust_tier: "T0_planning_inference" },
    });
    expect(frame.timestamp).toBeGreaterThanOrEqual(before);
  });

  it("broadcast sets sourceDeviceId from constructor", () => {
    const { propagator } = makeTestPropagator();
    const frame = propagator.broadcast({
      kind: "observation",
      data: { metric: "m", value: 1 },
      trust: { evidence_sources: [], evidence_trust_tier: "T2_operational_observation" },
    });
    expect(frame.sourceDeviceId).toBe("test-device-01");
  });
});

describe("ContextPropagator handleInbound dedup", () => {
  it("rejects duplicate frameId", () => {
    const { propagator } = makeTestPropagator();

    const frame: ContextFrame = {
      kind: "observation",
      frameId: "dup-001",
      sourceDeviceId: "remote-node",
      timestamp: Date.now(),
      data: { metric: "m", value: 1 },
      trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    };

    const result1 = propagator.handleInbound(frame, "remote-node");
    const result2 = propagator.handleInbound(frame, "remote-node");
    expect(result1).toBe(true);
    expect(result2).toBe(false); // Duplicate
  });

  it("rejects own frames (self-loop prevention)", () => {
    const { propagator } = makeTestPropagator();

    const frame: ContextFrame = {
      kind: "observation",
      frameId: "self-001",
      sourceDeviceId: "test-device-01", // Same as propagator source
      timestamp: Date.now(),
      data: { metric: "m", value: 1 },
      trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    };

    const result = propagator.handleInbound(frame, "other-peer");
    expect(result).toBe(false);
  });
});

describe("ContextPropagator hop behavior", () => {
  it("accepts frames with low hop count", () => {
    const { propagator } = makeTestPropagator();

    const frame: ContextFrame = {
      kind: "observation",
      frameId: "hop-002",
      sourceDeviceId: "remote",
      timestamp: Date.now(),
      data: { metric: "m", value: 1 },
      hops: 1,
      trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    };

    const result = propagator.handleInbound(frame, "remote");
    expect(result).toBe(true);
  });

  it("accepts frames without hops field (defaults to 0)", () => {
    const { propagator } = makeTestPropagator();

    const frame: ContextFrame = {
      kind: "observation",
      frameId: "hop-003",
      sourceDeviceId: "remote",
      timestamp: Date.now(),
      data: { metric: "m", value: 1 },
      trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    };

    const result = propagator.handleInbound(frame, "remote");
    expect(result).toBe(true);
  });
});
