import type { MeshForwardPayload, MeshTrustTier, MeshVerificationRequired } from "./types.js";

const TRUST_TIER_ORDER: Record<MeshTrustTier, number> = {
  T0_planning_inference: 0,
  T1_unverified_observation: 1,
  T2_operational_observation: 2,
  T3_verified_action_evidence: 3,
};

const VALID_VERIFICATION_REQUIREMENTS = new Set<MeshVerificationRequired>([
  "none",
  "device",
  "human",
  "device_or_human",
]);

type TrustDecision =
  | { ok: true }
  | {
      ok: false;
      code:
        | "INVALID_TRUST_POLICY"
        | "TRUST_METADATA_REQUIRED"
        | "INSUFFICIENT_TRUST_TIER"
        | "VERIFICATION_REQUIRED"
        | "LLM_ONLY_ACTUATION_BLOCKED";
      message: string;
    };

function isKnownTrustTier(value: unknown): value is MeshTrustTier {
  return typeof value === "string" && value in TRUST_TIER_ORDER;
}

function isKnownVerificationRequirement(value: unknown): value is MeshVerificationRequired {
  return typeof value === "string" && VALID_VERIFICATION_REQUIREMENTS.has(value as MeshVerificationRequired);
}

function hasAtLeastTrustTier(actual: MeshTrustTier, minimum: MeshTrustTier): boolean {
  return TRUST_TIER_ORDER[actual] >= TRUST_TIER_ORDER[minimum];
}

export function evaluateMeshForwardTrust(payload: MeshForwardPayload): TrustDecision {
  const trust = payload.trust;
  if (!trust) {
    return { ok: true };
  }

  if (trust.evidence_trust_tier && !isKnownTrustTier(trust.evidence_trust_tier)) {
    return {
      ok: false,
      code: "INVALID_TRUST_POLICY",
      message: `unknown evidence_trust_tier: ${String(trust.evidence_trust_tier)}`,
    };
  }

  if (trust.minimum_trust_tier && !isKnownTrustTier(trust.minimum_trust_tier)) {
    return {
      ok: false,
      code: "INVALID_TRUST_POLICY",
      message: `unknown minimum_trust_tier: ${String(trust.minimum_trust_tier)}`,
    };
  }

  if (trust.verification_required && !isKnownVerificationRequirement(trust.verification_required)) {
    return {
      ok: false,
      code: "INVALID_TRUST_POLICY",
      message: `unknown verification_required: ${String(trust.verification_required)}`,
    };
  }

  if (trust.action_type !== "actuation") {
    return { ok: true };
  }

  if (!trust.evidence_trust_tier || !trust.minimum_trust_tier || !trust.verification_required) {
    return {
      ok: false,
      code: "TRUST_METADATA_REQUIRED",
      message:
        "actuation commands must provide evidence_trust_tier, minimum_trust_tier, and verification_required",
    };
  }

  const evidenceSources = trust.evidence_sources ?? [];
  if (evidenceSources.length > 0 && evidenceSources.every((source) => source === "llm")) {
    return {
      ok: false,
      code: "LLM_ONLY_ACTUATION_BLOCKED",
      message: "actuation cannot be executed from LLM-only evidence; require sensor/device or human input",
    };
  }

  if (!hasAtLeastTrustTier(trust.evidence_trust_tier, trust.minimum_trust_tier)) {
    return {
      ok: false,
      code: "INSUFFICIENT_TRUST_TIER",
      message: `evidence_trust_tier ${trust.evidence_trust_tier} is below required ${trust.minimum_trust_tier}`,
    };
  }

  if (trust.verification_required !== "none" && trust.verification_satisfied !== true) {
    return {
      ok: false,
      code: "VERIFICATION_REQUIRED",
      message: `verification_required=${trust.verification_required} but verification_satisfied is not true`,
    };
  }

  return { ok: true };
}

export function compareMeshTrustTiers(a: MeshTrustTier, b: MeshTrustTier): number {
  return TRUST_TIER_ORDER[a] - TRUST_TIER_ORDER[b];
}

