/**
 * Protocol format tests — validate wire format correctness for all
 * message types exchanged between mesh peers.
 */

import { describe, it, expect } from "vitest";
import { createClawMeshCommandEnvelope, validateClawMeshCommandEnvelope, resolveMeshForwardTrustMetadata } from "./command-envelope.js";
import { buildMeshAuthPayload, verifyMeshConnectAuth, buildMeshConnectAuth } from "./handshake.js";
import { evaluateMeshForwardTrust } from "./trust-policy.js";
import { RpcDispatcher } from "./rpc-dispatcher.js";
import type { MeshForwardPayload } from "./types.js";

// ─── Command envelope format ────────────────────────

describe("Command envelope wire format", () => {
  it("has all required fields", () => {
    const env = createClawMeshCommandEnvelope({
      target: { kind: "capability", ref: "actuator:pump:P1" },
      operation: { name: "start" },
      trust: {
        action_type: "actuation",
        evidence_sources: ["sensor", "human"],
        evidence_trust_tier: "T3_verified_action_evidence",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "human",
        verification_satisfied: true,
        approved_by: ["operator"],
      },
    });

    // Wire format requirements
    expect(env.version).toBe(1);
    expect(env.kind).toBe("clawmesh.command");
    expect(typeof env.commandId).toBe("string");
    expect(env.commandId.length).toBeGreaterThan(0);
    expect(typeof env.createdAtMs).toBe("number");
    expect(env.target.kind).toBe("capability");
    expect(env.target.ref).toBe("actuator:pump:P1");
    expect(env.operation.name).toBe("start");
    expect(env.trust).toBeDefined();
  });

  it("validates correctly after creation", () => {
    const env = createClawMeshCommandEnvelope({
      target: { kind: "capability", ref: "sensor:moisture" },
      operation: { name: "read" },
      trust: {
        action_type: "observation",
        evidence_sources: ["sensor"],
        evidence_trust_tier: "T1_unverified_observation",
        minimum_trust_tier: "T0_planning_inference",
        verification_required: "none",
      },
    });
    expect(validateClawMeshCommandEnvelope(env)).toBe(true);
  });

  it("custom commandId and timestamp preserved", () => {
    const env = createClawMeshCommandEnvelope({
      commandId: "custom-id-123",
      createdAtMs: 1234567890,
      target: { kind: "device", ref: "jetson-01" },
      operation: { name: "ping" },
      trust: {
        action_type: "communication",
        evidence_sources: ["device"],
        evidence_trust_tier: "T2_operational_observation",
        minimum_trust_tier: "T1_unverified_observation",
        verification_required: "device",
      },
    });
    expect(env.commandId).toBe("custom-id-123");
    expect(env.createdAtMs).toBe(1234567890);
  });

  it("optional source field", () => {
    const env = createClawMeshCommandEnvelope({
      source: { nodeId: "mac-claw", role: "command-center" },
      target: { kind: "capability", ref: "sensor:moisture" },
      operation: { name: "read" },
      trust: {
        action_type: "observation",
        evidence_sources: ["sensor"],
        evidence_trust_tier: "T1_unverified_observation",
        minimum_trust_tier: "T0_planning_inference",
        verification_required: "none",
      },
    });
    expect(env.source?.nodeId).toBe("mac-claw");
    expect(env.source?.role).toBe("command-center");
  });
});

// ─── Trust policy evaluation ────────────────────────

describe("Trust policy evaluation", () => {
  function makePayload(overrides: Partial<MeshForwardPayload> = {}): MeshForwardPayload {
    return {
      channel: "clawmesh",
      to: "peer-1",
      originGatewayId: "gw-1",
      trust: {
        action_type: "actuation",
        evidence_sources: ["sensor", "human"],
        evidence_trust_tier: "T3_verified_action_evidence",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "human",
        verification_satisfied: true,
        approved_by: ["operator"],
      },
      ...overrides,
    } as MeshForwardPayload;
  }

  it("allows valid actuation with human verification", () => {
    const result = evaluateMeshForwardTrust(makePayload());
    expect(result.ok).toBe(true);
  });

  it("blocks LLM-only actuation (no human evidence)", () => {
    const result = evaluateMeshForwardTrust(makePayload({
      trust: {
        action_type: "actuation",
        evidence_sources: ["llm"],
        evidence_trust_tier: "T0_planning_inference",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "none",
      },
    }));
    expect(result.ok).toBe(false);
  });

  it("allows observation without strict verification", () => {
    const result = evaluateMeshForwardTrust(makePayload({
      trust: {
        action_type: "observation",
        evidence_sources: ["sensor"],
        evidence_trust_tier: "T1_unverified_observation",
        minimum_trust_tier: "T0_planning_inference",
        verification_required: "none",
      },
    }));
    expect(result.ok).toBe(true);
  });

  it("allows communication with minimal trust", () => {
    const result = evaluateMeshForwardTrust(makePayload({
      trust: {
        action_type: "communication",
        evidence_sources: ["human"],
        evidence_trust_tier: "T1_unverified_observation",
        minimum_trust_tier: "T0_planning_inference",
        verification_required: "none",
      },
    }));
    expect(result.ok).toBe(true);
  });
});

// ─── RPC dispatcher format ──────────────────────────

describe("RPC dispatcher wire format", () => {
  it("dispatches to registered handler", async () => {
    const rpc = new RpcDispatcher();
    let receivedParams: any;
    rpc.register("test.method", ({ params, respond }) => {
      receivedParams = params;
      respond(true, { result: "ok" });
    });

    const socket = { send: () => {}, readyState: 1 } as any;
    await rpc.dispatch(socket, "conn-1", { type: "req", id: "req-1", method: "test.method", params: { key: "value" } });
    expect(receivedParams).toEqual({ key: "value" });
  });

  it("returns error for unregistered method", async () => {
    const rpc = new RpcDispatcher();
    let sentData: string | undefined;
    const socket = { send: (d: string) => { sentData = d; }, readyState: 1 } as any;
    await rpc.dispatch(socket, "conn-1", { type: "req", id: "req-1", method: "unknown.method", params: {} });
    expect(sentData).toBeDefined();
    const parsed = JSON.parse(sentData!);
    expect(parsed.ok).toBe(false);
  });
});

// ─── Handshake auth payload format ──────────────────

describe("Handshake auth payload format", () => {
  it("v1 format with pipe separators", () => {
    const payload = buildMeshAuthPayload({
      deviceId: "abc123",
      signedAtMs: 1234567890000,
    });
    const parts = payload.split("|");
    expect(parts[0]).toBe("mesh.connect");
    expect(parts[1]).toBe("v1");
    expect(parts[2]).toBe("abc123");
    expect(parts[3]).toBe("1234567890000");
  });

  it("nonce adds fifth part", () => {
    const payload = buildMeshAuthPayload({
      deviceId: "abc",
      signedAtMs: 1000,
      nonce: "n123",
    });
    const parts = payload.split("|");
    expect(parts).toHaveLength(5);
    expect(parts[4]).toBe("n123");
  });

  it("auth payload is deterministic", () => {
    const a = buildMeshAuthPayload({ deviceId: "x", signedAtMs: 999 });
    const b = buildMeshAuthPayload({ deviceId: "x", signedAtMs: 999 });
    expect(a).toBe(b);
  });
});
