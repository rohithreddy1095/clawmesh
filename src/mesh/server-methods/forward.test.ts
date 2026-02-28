import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DeviceIdentity } from "../../infra/device-identity.js";
import type { MeshForwardPayload } from "../types.js";
import { createMeshForwardHandlers } from "./forward.js";

type Handlers = Record<string, (opts: {
  params: Record<string, unknown>;
  respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void;
}) => void | Promise<void>>;

const localIdentity: DeviceIdentity = {
  deviceId: "local-gateway-id",
  publicKeyPem: "mock-pub",
  privateKeyPem: "mock-priv",
};

function callHandler(
  handlers: Handlers,
  method: string,
  params: Record<string, unknown> = {},
) {
  return new Promise<{ ok: boolean; payload?: unknown; error?: { code: string; message: string } }>((resolve) => {
    const respond = (ok: boolean, payload?: unknown, error?: { code: string; message: string }) =>
      resolve({ ok, payload, error });
    void handlers[method]({ params, respond });
  });
}

describe("mesh.message.forward handler", () => {
  let handlers: Handlers;
  let onForward: ReturnType<typeof vi.fn<(payload: MeshForwardPayload) => void>>;

  beforeEach(() => {
    onForward = vi.fn<(payload: MeshForwardPayload) => void>();
    handlers = createMeshForwardHandlers({ identity: localIdentity, onForward });
  });

  it("valid forward delivers message and returns messageId", async () => {
    const { ok, payload } = await callHandler(handlers, "mesh.message.forward", {
      channel: "telegram",
      to: "user-123",
      message: "Hello from peer",
      originGatewayId: "remote-gateway-id",
      idempotencyKey: "idem-1",
    });
    expect(ok).toBe(true);
    const result = payload as { messageId: string; channel: string };
    expect(result.messageId).toBeTruthy();
    expect(result.channel).toBe("telegram");
    expect(onForward).toHaveBeenCalledOnce();
  });

  it("missing params returns INVALID_PARAMS error", async () => {
    const { ok, error } = await callHandler(handlers, "mesh.message.forward", {
      channel: "telegram",
    });
    expect(ok).toBe(false);
    expect(error?.code).toBe("INVALID_PARAMS");
  });

  it("loop detected (originGatewayId matches local) returns LOOP_DETECTED error", async () => {
    const { ok, error } = await callHandler(handlers, "mesh.message.forward", {
      channel: "telegram",
      to: "user-123",
      message: "looped message",
      originGatewayId: "local-gateway-id",
      idempotencyKey: "idem-2",
    });
    expect(ok).toBe(false);
    expect(error?.code).toBe("LOOP_DETECTED");
  });

  it("delivery failure returns DELIVERY_FAILED error", async () => {
    onForward.mockRejectedValueOnce(new Error("delivery boom"));

    const { ok, error } = await callHandler(handlers, "mesh.message.forward", {
      channel: "telegram",
      to: "user-123",
      message: "will fail",
      originGatewayId: "remote-gateway-id",
      idempotencyKey: "idem-3",
    });
    expect(ok).toBe(false);
    expect(error?.code).toBe("DELIVERY_FAILED");
  });

  it("blocks LLM-only actuation commands", async () => {
    const { ok, error } = await callHandler(handlers, "mesh.message.forward", {
      channel: "clawmesh",
      to: "actuator:pump:P1",
      message: "start pump",
      originGatewayId: "remote-gateway-id",
      trust: {
        action_type: "actuation",
        evidence_sources: ["llm"],
        evidence_trust_tier: "T3_verified_action_evidence",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "none",
      },
    });
    expect(ok).toBe(false);
    expect(error?.code).toBe("LLM_ONLY_ACTUATION_BLOCKED");
  });

  it("blocks actuation with insufficient trust tier", async () => {
    const { ok, error } = await callHandler(handlers, "mesh.message.forward", {
      channel: "clawmesh",
      to: "actuator:pump:P1",
      message: "start pump",
      originGatewayId: "remote-gateway-id",
      trust: {
        action_type: "actuation",
        evidence_sources: ["sensor"],
        evidence_trust_tier: "T1_unverified_observation",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "none",
      },
    });
    expect(ok).toBe(false);
    expect(error?.code).toBe("INSUFFICIENT_TRUST_TIER");
  });

  it("allows actuation with proper trust metadata", async () => {
    const { ok } = await callHandler(handlers, "mesh.message.forward", {
      channel: "clawmesh",
      to: "actuator:pump:P1",
      message: "start pump",
      originGatewayId: "remote-gateway-id",
      trust: {
        action_type: "actuation",
        evidence_sources: ["sensor", "human"],
        evidence_trust_tier: "T3_verified_action_evidence",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "human",
        verification_satisfied: true,
        approved_by: ["operator:local-cli"],
      },
    });
    expect(ok).toBe(true);
  });
});
