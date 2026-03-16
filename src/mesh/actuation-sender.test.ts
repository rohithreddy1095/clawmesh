import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendActuation, defaultActuationTrust, type ActuationDeps, type ActuationParams } from "./actuation-sender.js";
import { PeerRegistry } from "./peer-registry.js";
import { TrustAuditTrail } from "./trust-audit.js";
import type { PeerSession } from "./types.js";

function createMockSocket() {
  return {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  } as unknown as PeerSession["socket"];
}

function createDeps(overrides?: Partial<ActuationDeps>): ActuationDeps {
  return {
    peerRegistry: new PeerRegistry(),
    deviceId: "sender-device-id",
    trustAudit: new TrustAuditTrail(),
    log: { warn: () => {} },
    ...overrides,
  };
}

describe("defaultActuationTrust", () => {
  it("returns safe defaults with sensor+human evidence", () => {
    const trust = defaultActuationTrust();
    expect(trust.action_type).toBe("actuation");
    expect(trust.evidence_sources).toContain("sensor");
    expect(trust.evidence_sources).toContain("human");
    expect(trust.evidence_trust_tier).toBe("T3_verified_action_evidence");
    expect(trust.verification_satisfied).toBe(true);
  });
});

describe("sendActuation", () => {
  let deps: ActuationDeps;

  beforeEach(() => {
    deps = createDeps();
  });

  it("blocks LLM-only actuation before forwarding", async () => {
    const result = await sendActuation(
      {
        peerDeviceId: "peer-1",
        targetRef: "actuator:pump:P1",
        operation: "start",
        trust: {
          action_type: "actuation",
          evidence_sources: ["llm"],
          evidence_trust_tier: "T3_verified_action_evidence",
          minimum_trust_tier: "T2_operational_observation",
          verification_required: "none",
        },
      },
      deps,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("LLM_ONLY_ACTUATION_BLOCKED");
  });

  it("records trust decision in audit trail", async () => {
    await sendActuation(
      {
        peerDeviceId: "peer-1",
        targetRef: "actuator:pump:P1",
        operation: "start",
      },
      deps,
    );

    expect(deps.trustAudit!.size).toBe(1);
    const stats = deps.trustAudit!.getStats();
    // The default trust should pass, but the forward to a non-connected peer will fail
    expect(stats.total).toBe(1);
  });

  it("uses default trust when none provided", async () => {
    const result = await sendActuation(
      {
        peerDeviceId: "peer-1",
        targetRef: "actuator:pump:P1",
        operation: "start",
        // No trust = uses defaultActuationTrust()
      },
      deps,
    );

    // Trust should pass (default has sensor+human), but peer isn't connected
    const audit = deps.trustAudit!.getRecent(1);
    expect(audit[0].ok).toBe(true); // Trust passed
    // But forward fails because peer not connected
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not connected");
  });

  it("forwards to connected peer when trust passes", async () => {
    // Register a connected peer
    const socket = createMockSocket();
    deps.peerRegistry.register({
      deviceId: "peer-1",
      connId: "conn-1",
      socket,
      outbound: true,
      capabilities: ["actuator:pump:P1"],
      connectedAtMs: Date.now(),
    });

    // sendActuation sends the RPC but the peer won't respond (it's a mock)
    // The invoke will timeout — so we just verify it doesn't throw
    const resultPromise = sendActuation(
      {
        peerDeviceId: "peer-1",
        targetRef: "actuator:pump:P1",
        operation: "start",
        note: "Test actuation",
      },
      deps,
    );

    // Verify the message was sent to the socket
    // Give the async RPC a moment
    await new Promise((r) => setTimeout(r, 50));
    expect(socket.send).toHaveBeenCalled();

    // Clean up the pending promise (will timeout but we don't need to wait)
    deps.peerRegistry.unregister("conn-1");
  });

  it("blocks actuation with insufficient trust tier", async () => {
    const result = await sendActuation(
      {
        peerDeviceId: "peer-1",
        targetRef: "actuator:pump:P1",
        operation: "start",
        trust: {
          action_type: "actuation",
          evidence_sources: ["sensor"],
          evidence_trust_tier: "T1_unverified_observation",
          minimum_trust_tier: "T2_operational_observation",
          verification_required: "none",
        },
      },
      deps,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("INSUFFICIENT_TRUST_TIER");
  });

  it("blocks actuation with unsatisfied verification", async () => {
    const result = await sendActuation(
      {
        peerDeviceId: "peer-1",
        targetRef: "actuator:pump:P1",
        operation: "start",
        trust: {
          action_type: "actuation",
          evidence_sources: ["sensor", "human"],
          evidence_trust_tier: "T3_verified_action_evidence",
          minimum_trust_tier: "T2_operational_observation",
          verification_required: "human",
          // verification_satisfied is undefined → fails
        },
      },
      deps,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("VERIFICATION_REQUIRED");
  });

  it("includes operation params in forwarded command", async () => {
    const socket = createMockSocket();
    deps.peerRegistry.register({
      deviceId: "peer-1",
      connId: "conn-1",
      socket,
      outbound: true,
      capabilities: [],
      connectedAtMs: Date.now(),
    });

    sendActuation(
      {
        peerDeviceId: "peer-1",
        targetRef: "actuator:valve:V1",
        operation: "open",
        operationParams: { durationSec: 300 },
        note: "Zone-1 irrigation",
      },
      deps,
    );

    // Verify the command was sent with params
    await new Promise((r) => setTimeout(r, 50));
    expect(socket.send).toHaveBeenCalled();
    const sent = JSON.parse((socket.send as any).mock.calls[0][0]);
    expect(sent.params.message).toBe("Zone-1 irrigation");

    deps.peerRegistry.unregister("conn-1");
  });

  it("works without trustAudit dependency", async () => {
    const depsNoAudit = createDeps({ trustAudit: undefined });

    const result = await sendActuation(
      {
        peerDeviceId: "peer-1",
        targetRef: "actuator:pump:P1",
        operation: "start",
        trust: {
          action_type: "actuation",
          evidence_sources: ["llm"],
          evidence_trust_tier: "T3_verified_action_evidence",
          minimum_trust_tier: "T2_operational_observation",
          verification_required: "none",
        },
      },
      depsNoAudit,
    );

    // Should still block — trust evaluation doesn't require audit trail
    expect(result.ok).toBe(false);
    expect(result.error).toContain("LLM_ONLY_ACTUATION_BLOCKED");
  });
});
