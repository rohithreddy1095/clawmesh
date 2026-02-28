import { describe, expect, it, vi } from "vitest";
import { createClawMeshCommandEnvelope } from "../command-envelope.js";
import { createMeshForwardHandlers } from "./forward.js";
import type { DeviceIdentity } from "../../infra/device-identity.js";
import type { MeshForwardPayload } from "../types.js";

const localIdentity: DeviceIdentity = {
  deviceId: "local-gateway-id",
  publicKeyPem: "mock-pub",
  privateKeyPem: "mock-priv",
};

async function callForwardHandler(
  params: Record<string, unknown>,
  onForward?: (payload: MeshForwardPayload) => void | Promise<void>,
) {
  const handlers = createMeshForwardHandlers({ identity: localIdentity, onForward });

  return new Promise<{
    ok: boolean;
    payload?: unknown;
    error?: { code: string; message: string };
  }>((resolve) => {
    void handlers["mesh.message.forward"]({
      params,
      respond: (ok, payload, error) => resolve({ ok, payload, error }),
    });
  });
}

describe("mesh.message.forward trust gating", () => {
  it("blocks LLM-only actuation before onForward is called", async () => {
    const onForward = vi.fn();

    const result = await callForwardHandler(
      {
        channel: "clawmesh",
        to: "actuator:valve:zone-a",
        message: "open 30s",
        originGatewayId: "peer-jetson",
        idempotencyKey: "idem-1",
        trust: {
          action_type: "actuation",
          evidence_sources: ["llm"],
          evidence_trust_tier: "T3_verified_action_evidence",
          minimum_trust_tier: "T2_operational_observation",
          verification_required: "none",
        },
      },
      onForward,
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("LLM_ONLY_ACTUATION_BLOCKED");
    expect(onForward).not.toHaveBeenCalled();
  });

  it("accepts actuation when trust tier and verification are satisfied", async () => {
    const onForward = vi.fn();

    const result = await callForwardHandler(
      {
        channel: "clawmesh",
        to: "actuator:valve:zone-a",
        message: "open 30s",
        originGatewayId: "peer-jetson",
        idempotencyKey: "idem-2",
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
      onForward,
    );

    expect(result.ok).toBe(true);
    expect(onForward).toHaveBeenCalledOnce();
  });

  it("enforces trust from command envelope when top-level trust is omitted", async () => {
    const onForward = vi.fn();
    const command = createClawMeshCommandEnvelope({
      source: { nodeId: "mac-claw", role: "planner" },
      target: { kind: "capability", ref: "actuator:valve:zone-a" },
      operation: { name: "open", params: { durationSec: 30 } },
      trust: {
        action_type: "actuation",
        evidence_sources: ["llm"],
        evidence_trust_tier: "T3_verified_action_evidence",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "none",
      },
    });

    const result = await callForwardHandler(
      {
        channel: "clawmesh",
        to: "actuator:valve:zone-a",
        originGatewayId: "peer-jetson",
        idempotencyKey: "idem-3",
        command,
      },
      onForward,
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("LLM_ONLY_ACTUATION_BLOCKED");
    expect(onForward).not.toHaveBeenCalled();
  });

  it("rejects mismatched envelope trust and top-level trust", async () => {
    const command = createClawMeshCommandEnvelope({
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

    const result = await callForwardHandler({
      channel: "clawmesh",
      to: "actuator:valve:zone-a",
      originGatewayId: "peer-jetson",
      idempotencyKey: "idem-4",
      command,
      trust: {
        ...command.trust,
        minimum_trust_tier: "T3_verified_action_evidence",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TRUST_ENVELOPE_MISMATCH");
  });
});
