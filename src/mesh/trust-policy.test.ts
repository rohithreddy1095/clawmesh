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
});

