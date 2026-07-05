import type {
  MeshForwardTrustMetadata,
  MeshTrustTier,
  MeshVerificationRequired,
} from "./types.js";

export type LlmEvidenceTrust = {
  evidence_sources: ["llm"];
  evidence_trust_tier: "T0_planning_inference";
};

export function createLlmEvidenceTrust(): LlmEvidenceTrust {
  return {
    evidence_sources: ["llm"],
    evidence_trust_tier: "T0_planning_inference",
  };
}

export function createLlmOnlyActuationTrust(
  overrides: Partial<MeshForwardTrustMetadata> = {},
): MeshForwardTrustMetadata & {
  action_type: "actuation";
  evidence_trust_tier: "T0_planning_inference";
  minimum_trust_tier: MeshTrustTier;
  verification_required: MeshVerificationRequired;
} {
  const minimumTrustTier = overrides.minimum_trust_tier ?? "T2_operational_observation";
  const verificationRequired = overrides.verification_required ?? "none";
  return {
    ...overrides,
    action_type: "actuation",
    evidence_sources: ["llm"],
    evidence_trust_tier: "T0_planning_inference",
    minimum_trust_tier: minimumTrustTier,
    verification_required: verificationRequired,
  };
}
