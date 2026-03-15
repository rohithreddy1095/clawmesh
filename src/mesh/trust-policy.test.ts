import { describe, expect, it } from "vitest";
import { evaluateMeshForwardTrust, compareMeshTrustTiers } from "./trust-policy.js";
import type { MeshForwardPayload } from "./types.js";

function basePayload(): MeshForwardPayload {
  return {
    channel: "clawmesh",
    to: "valve:zone-a",
    originGatewayId: "peer-jetson",
    idempotencyKey: "idem-1",
  };
}

describe("mesh trust policy", () => {
  it("allows legacy forwards without trust metadata", () => {
    expect(evaluateMeshForwardTrust(basePayload())).toEqual({ ok: true });
  });

  it("blocks actuation when evidence is LLM-only", () => {
    const result = evaluateMeshForwardTrust({
      ...basePayload(),
      trust: {
        action_type: "actuation",
        evidence_sources: ["llm"],
        evidence_trust_tier: "T3_verified_action_evidence",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "none",
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("LLM_ONLY_ACTUATION_BLOCKED");
    }
  });

  it("blocks actuation when evidence tier is below the required tier", () => {
    const result = evaluateMeshForwardTrust({
      ...basePayload(),
      trust: {
        action_type: "actuation",
        evidence_sources: ["sensor"],
        evidence_trust_tier: "T1_unverified_observation",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "none",
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INSUFFICIENT_TRUST_TIER");
    }
  });

  it("requires verification when policy demands it", () => {
    const result = evaluateMeshForwardTrust({
      ...basePayload(),
      trust: {
        action_type: "actuation",
        evidence_sources: ["sensor", "human"],
        evidence_trust_tier: "T3_verified_action_evidence",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "human",
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VERIFICATION_REQUIRED");
    }
  });

  it("allows actuation when trust and verification requirements are satisfied", () => {
    const result = evaluateMeshForwardTrust({
      ...basePayload(),
      trust: {
        action_type: "actuation",
        evidence_sources: ["sensor", "human"],
        evidence_trust_tier: "T3_verified_action_evidence",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "human",
        verification_satisfied: true,
        approved_by: ["operator:rohith"],
      },
    });

    expect(result).toEqual({ ok: true });
  });

  it("orders trust tiers correctly", () => {
    expect(compareMeshTrustTiers("T3_verified_action_evidence", "T2_operational_observation")).toBeGreaterThan(
      0,
    );
    expect(compareMeshTrustTiers("T0_planning_inference", "T0_planning_inference")).toBe(0);
  });

  // ─── Additional edge cases ────────────────

  it("allows non-actuation communication without trust metadata", () => {
    const result = evaluateMeshForwardTrust({
      ...basePayload(),
      trust: {
        action_type: "communication",
      },
    });
    expect(result).toEqual({ ok: true });
  });

  it("allows non-actuation observation without trust metadata", () => {
    const result = evaluateMeshForwardTrust({
      ...basePayload(),
      trust: {
        action_type: "observation",
      },
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects actuation with missing required trust fields", () => {
    const result = evaluateMeshForwardTrust({
      ...basePayload(),
      trust: {
        action_type: "actuation",
        // Missing: evidence_trust_tier, minimum_trust_tier, verification_required
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("TRUST_METADATA_REQUIRED");
    }
  });

  it("rejects invalid trust tier values", () => {
    const result = evaluateMeshForwardTrust({
      ...basePayload(),
      trust: {
        evidence_trust_tier: "INVALID_TIER" as any,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_TRUST_POLICY");
    }
  });

  it("rejects invalid verification_required values", () => {
    const result = evaluateMeshForwardTrust({
      ...basePayload(),
      trust: {
        verification_required: "quantum_entangled" as any,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_TRUST_POLICY");
    }
  });

  it("allows actuation with mixed evidence sources (sensor + human)", () => {
    const result = evaluateMeshForwardTrust({
      ...basePayload(),
      trust: {
        action_type: "actuation",
        evidence_sources: ["sensor", "human"],
        evidence_trust_tier: "T3_verified_action_evidence",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "none",
      },
    });
    expect(result).toEqual({ ok: true });
  });

  it("allows actuation with device_or_human verification satisfied", () => {
    const result = evaluateMeshForwardTrust({
      ...basePayload(),
      trust: {
        action_type: "actuation",
        evidence_sources: ["sensor", "device"],
        evidence_trust_tier: "T3_verified_action_evidence",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "device_or_human",
        verification_satisfied: true,
      },
    });
    expect(result).toEqual({ ok: true });
  });

  it("allows actuation with exact tier match (T2 meets T2 minimum)", () => {
    const result = evaluateMeshForwardTrust({
      ...basePayload(),
      trust: {
        action_type: "actuation",
        evidence_sources: ["sensor"],
        evidence_trust_tier: "T2_operational_observation",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "none",
      },
    });
    expect(result).toEqual({ ok: true });
  });

  it("orders all trust tiers", () => {
    expect(compareMeshTrustTiers("T0_planning_inference", "T1_unverified_observation")).toBeLessThan(0);
    expect(compareMeshTrustTiers("T1_unverified_observation", "T2_operational_observation")).toBeLessThan(0);
    expect(compareMeshTrustTiers("T2_operational_observation", "T3_verified_action_evidence")).toBeLessThan(0);
    expect(compareMeshTrustTiers("T3_verified_action_evidence", "T0_planning_inference")).toBeGreaterThan(0);
  });
});

