import { describe, expect, it } from "vitest";
import {
  buildClawMeshForwardPayload,
  createClawMeshCommandEnvelope,
  resolveMeshForwardTrustMetadata,
  validateClawMeshCommandEnvelope,
} from "./command-envelope.js";

describe("clawmesh command envelope", () => {
  it("creates a v1 command envelope with required metadata", () => {
    const envelope = createClawMeshCommandEnvelope({
      source: { nodeId: "mac-claw", role: "planner" },
      target: { kind: "capability", ref: "actuator:valve:zone-a" },
      operation: { name: "open", params: { durationSec: 30 } },
      trust: {
        action_type: "actuation",
        evidence_sources: ["sensor", "human"],
        evidence_trust_tier: "T3_verified_action_evidence",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "human",
        verification_satisfied: true,
      },
    });

    expect(envelope.version).toBe(1);
    expect(envelope.kind).toBe("clawmesh.command");
    expect(envelope.commandId).toBeTruthy();
    expect(envelope.createdAtMs).toBeTypeOf("number");
    expect(validateClawMeshCommandEnvelope(envelope)).toBe(true);
  });

  it("builds a clawmesh forward payload with mirrored trust metadata", () => {
    const payload = buildClawMeshForwardPayload({
      to: "actuator:valve:zone-a",
      originGatewayId: "mac-gateway",
      idempotencyKey: "idem-1",
      command: {
        source: { nodeId: "mac-claw", role: "planner" },
        target: { kind: "capability", ref: "actuator:valve:zone-a" },
        operation: { name: "open", params: { durationSec: 45 } },
        trust: {
          action_type: "actuation",
          evidence_sources: ["sensor", "human"],
          evidence_trust_tier: "T3_verified_action_evidence",
          minimum_trust_tier: "T2_operational_observation",
          verification_required: "human",
          verification_satisfied: true,
          approved_by: ["operator:rohith"],
        },
      },
    });

    expect(payload.channel).toBe("clawmesh");
    expect(payload.command?.operation.name).toBe("open");
    expect(payload.trust).toEqual(payload.command?.trust);
  });

  it("rejects mismatched top-level trust and envelope trust", () => {
    const envelope = createClawMeshCommandEnvelope({
      source: { nodeId: "jetson-claw", role: "executor" },
      target: { kind: "capability", ref: "actuator:pump:main" },
      operation: { name: "start" },
      trust: {
        action_type: "actuation",
        evidence_sources: ["sensor"],
        evidence_trust_tier: "T2_operational_observation",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "device",
        verification_satisfied: true,
      },
    });

    const result = resolveMeshForwardTrustMetadata({
      channel: "clawmesh",
      to: "actuator:pump:main",
      originGatewayId: "jetson-gateway",
      idempotencyKey: "idem-2",
      command: envelope,
      trust: {
        ...envelope.trust,
        minimum_trust_tier: "T3_verified_action_evidence",
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("TRUST_ENVELOPE_MISMATCH");
    }
  });
});

