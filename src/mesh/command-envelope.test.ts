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

  // ─── Additional validation tests ─────────

  it("validates a correct standalone envelope", () => {
    const envelope = createClawMeshCommandEnvelope({
      target: { kind: "capability", ref: "actuator:pump:P1" },
      operation: { name: "start" },
      trust: {
        action_type: "actuation",
        evidence_trust_tier: "T3_verified_action_evidence",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "human",
      },
    });
    expect(validateClawMeshCommandEnvelope(envelope)).toBe(true);
  });

  it("rejects envelope with wrong version", () => {
    expect(validateClawMeshCommandEnvelope({ version: 2, kind: "clawmesh.command" })).toBe(false);
  });

  it("rejects envelope with wrong kind", () => {
    expect(validateClawMeshCommandEnvelope({ version: 1, kind: "other" })).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(validateClawMeshCommandEnvelope(null)).toBe(false);
    expect(validateClawMeshCommandEnvelope(42)).toBe(false);
    expect(validateClawMeshCommandEnvelope("string")).toBe(false);
  });

  it("resolveMeshForwardTrustMetadata passes when no command", () => {
    const result = resolveMeshForwardTrustMetadata({
      channel: "clawmesh",
      to: "test",
      originGatewayId: "gw",
      idempotencyKey: "k",
      trust: { action_type: "communication" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trust?.action_type).toBe("communication");
    }
  });

  it("resolveMeshForwardTrustMetadata rejects invalid envelope", () => {
    const result = resolveMeshForwardTrustMetadata({
      channel: "clawmesh",
      to: "test",
      originGatewayId: "gw",
      idempotencyKey: "k",
      command: { version: 99 } as any,
    });
    expect(result.ok).toBe(false);
  });

  it("createClawMeshCommandEnvelope uses provided commandId", () => {
    const envelope = createClawMeshCommandEnvelope({
      commandId: "custom-id-123",
      target: { kind: "capability", ref: "x" },
      operation: { name: "y" },
      trust: {
        action_type: "communication",
        evidence_trust_tier: "T0_planning_inference",
        minimum_trust_tier: "T0_planning_inference",
        verification_required: "none",
      },
    });
    expect(envelope.commandId).toBe("custom-id-123");
  });
});
