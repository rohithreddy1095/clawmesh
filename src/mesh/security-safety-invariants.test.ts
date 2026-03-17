/**
 * Security and safety invariant tests.
 *
 * Validates that security-critical properties hold across the system:
 * - Actuation always requires human verification
 * - Trust tiers are correctly enforced
 * - Message signing works correctly
 * - LLM alone cannot trigger physical actions
 */

import { describe, it, expect } from "vitest";
import { evaluateMeshForwardTrust, compareMeshTrustTiers } from "./trust-policy.js";
import { validateClawMeshCommandEnvelope, createClawMeshCommandEnvelope } from "./command-envelope.js";
import { isPermanentLLMError } from "../agents/threshold-checker.js";
import { deriveActuatorStatus, isActuatorRef } from "./actuator-logic.js";
import { meetsAlertSeverity } from "../channels/telegram-helpers.js";
import { buildMeshAuthPayload } from "./handshake.js";
import type { MeshForwardPayload, MeshTrustTier } from "./types.js";

// ─── Safety: LLM cannot actuate alone ───────────────

describe("Safety - LLM actuation blocking", () => {
  it("blocks actuation with only LLM evidence", () => {
    const payload = {
      channel: "clawmesh",
      to: "peer",
      originGatewayId: "gw",
      trust: {
        action_type: "actuation",
        evidence_sources: ["llm"],
        evidence_trust_tier: "T0_planning_inference",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "none",
      },
    } as MeshForwardPayload;
    const result = evaluateMeshForwardTrust(payload);
    expect(result.ok).toBe(false);
  });

  it("blocks actuation with T0 trust tier", () => {
    const payload = {
      channel: "clawmesh",
      to: "peer",
      originGatewayId: "gw",
      trust: {
        action_type: "actuation",
        evidence_sources: ["llm", "sensor"],
        evidence_trust_tier: "T0_planning_inference",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "none",
      },
    } as MeshForwardPayload;
    const result = evaluateMeshForwardTrust(payload);
    expect(result.ok).toBe(false);
  });

  it("allows actuation with proper human + sensor evidence", () => {
    const payload = {
      channel: "clawmesh",
      to: "peer",
      originGatewayId: "gw",
      trust: {
        action_type: "actuation",
        evidence_sources: ["sensor", "human"],
        evidence_trust_tier: "T3_verified_action_evidence",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "human",
        verification_satisfied: true,
        approved_by: ["operator"],
      },
    } as MeshForwardPayload;
    const result = evaluateMeshForwardTrust(payload);
    expect(result.ok).toBe(true);
  });
});

// ─── Safety: Trust tier ordering ────────────────────

describe("Safety - trust tier hierarchy", () => {
  const tiers: MeshTrustTier[] = [
    "T0_planning_inference",
    "T1_unverified_observation",
    "T2_operational_observation",
    "T3_verified_action_evidence",
  ];

  it("strict ordering T0 < T1 < T2 < T3", () => {
    for (let i = 0; i < tiers.length - 1; i++) {
      expect(compareMeshTrustTiers(tiers[i], tiers[i + 1])).toBeLessThan(0);
    }
  });

  it("reverse ordering T3 > T2 > T1 > T0", () => {
    for (let i = tiers.length - 1; i > 0; i--) {
      expect(compareMeshTrustTiers(tiers[i], tiers[i - 1])).toBeGreaterThan(0);
    }
  });

  it("transitivity: if A < B and B < C then A < C", () => {
    expect(compareMeshTrustTiers(tiers[0], tiers[2])).toBeLessThan(0);
    expect(compareMeshTrustTiers(tiers[0], tiers[3])).toBeLessThan(0);
    expect(compareMeshTrustTiers(tiers[1], tiers[3])).toBeLessThan(0);
  });
});

// ─── Safety: Command envelope validation ────────────

describe("Safety - command envelope integrity", () => {
  it("rejects envelopes with wrong version", () => {
    expect(validateClawMeshCommandEnvelope({ version: 2, kind: "clawmesh.command" })).toBe(false);
  });

  it("rejects envelopes with wrong kind", () => {
    expect(validateClawMeshCommandEnvelope({ version: 1, kind: "other" })).toBe(false);
  });

  it("rejects envelopes without commandId", () => {
    expect(validateClawMeshCommandEnvelope({
      version: 1,
      kind: "clawmesh.command",
      commandId: "",
    })).toBe(false);
  });

  it("accepts valid envelopes", () => {
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
      },
    });
    expect(validateClawMeshCommandEnvelope(env)).toBe(true);
  });
});

// ─── Safety: Error classification ───────────────────

describe("Safety - error classification accuracy", () => {
  it("permanent errors include auth failures", () => {
    const authErrors = ["403", "401", "forbidden", "unauthorized", "disabled", "terms of service", "account"];
    for (const keyword of authErrors) {
      expect(isPermanentLLMError(`Error: ${keyword}`)).toBe(true);
    }
  });

  it("transient errors are not marked permanent", () => {
    const transient = ["timeout", "ETIMEDOUT", "ECONNRESET", "429", "500", "502", "503"];
    for (const keyword of transient) {
      expect(isPermanentLLMError(keyword)).toBe(false);
    }
  });
});

// ─── Safety: Alert severity ordering ────────────────

describe("Safety - alert severity ordering", () => {
  it("critical alerts always pass any threshold", () => {
    expect(meetsAlertSeverity("critical", "normal")).toBe(true);
    expect(meetsAlertSeverity("critical", "low")).toBe(true);
    expect(meetsAlertSeverity("critical", "critical")).toBe(true);
  });

  it("normal alerts only pass normal threshold", () => {
    expect(meetsAlertSeverity("normal", "normal")).toBe(true);
    expect(meetsAlertSeverity("normal", "low")).toBe(false);
    expect(meetsAlertSeverity("normal", "critical")).toBe(false);
  });
});

// ─── Safety: Actuator target protection ─────────────

describe("Safety - actuator target protection", () => {
  it("all actuator refs are correctly identified", () => {
    const actuatorRefs = [
      "actuator:pump:P1",
      "actuator:valve:V1",
      "actuator:relay:R1",
      "actuator:motor:M1",
    ];
    for (const ref of actuatorRefs) {
      expect(isActuatorRef(ref)).toBe(true);
    }
  });

  it("sensor refs are not actuators", () => {
    expect(isActuatorRef("sensor:moisture:zone-1")).toBe(false);
    expect(isActuatorRef("channel:telegram")).toBe(false);
    expect(isActuatorRef("skill:planning")).toBe(false);
  });
});

// ─── Safety: Auth payload format ────────────────────

describe("Safety - auth payload tamper resistance", () => {
  it("different device IDs produce different payloads", () => {
    const a = buildMeshAuthPayload({ deviceId: "abc", signedAtMs: 1000 });
    const b = buildMeshAuthPayload({ deviceId: "xyz", signedAtMs: 1000 });
    expect(a).not.toBe(b);
  });

  it("different timestamps produce different payloads", () => {
    const a = buildMeshAuthPayload({ deviceId: "abc", signedAtMs: 1000 });
    const b = buildMeshAuthPayload({ deviceId: "abc", signedAtMs: 2000 });
    expect(a).not.toBe(b);
  });

  it("nonce changes payload", () => {
    const a = buildMeshAuthPayload({ deviceId: "abc", signedAtMs: 1000, nonce: "n1" });
    const b = buildMeshAuthPayload({ deviceId: "abc", signedAtMs: 1000, nonce: "n2" });
    expect(a).not.toBe(b);
  });
});
