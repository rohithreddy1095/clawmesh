import { randomUUID } from "node:crypto";
import type {
  ClawMeshCommandEnvelopeV1,
  MeshForwardPayload,
  MeshForwardTrustMetadata,
  MeshTrustTier,
  MeshVerificationRequired,
} from "./types.js";

type ResolveTrustResult =
  | { ok: true; trust?: MeshForwardTrustMetadata }
  | {
      ok: false;
      code: "INVALID_COMMAND_ENVELOPE" | "TRUST_ENVELOPE_MISMATCH";
      message: string;
    };

type CreateClawMeshCommandEnvelopeParams = Omit<
  ClawMeshCommandEnvelopeV1,
  "version" | "kind" | "commandId" | "createdAtMs"
> & {
  commandId?: string;
  createdAtMs?: number;
};

const TRUST_KEYS: Array<keyof MeshForwardTrustMetadata> = [
  "action_type",
  "evidence_trust_tier",
  "minimum_trust_tier",
  "verification_required",
  "verification_satisfied",
  "evidence_sources",
  "approved_by",
];

function isKnownTrustTier(value: unknown): value is MeshTrustTier {
  return (
    value === "T0_planning_inference" ||
    value === "T1_unverified_observation" ||
    value === "T2_operational_observation" ||
    value === "T3_verified_action_evidence"
  );
}

function isKnownVerificationRequirement(value: unknown): value is MeshVerificationRequired {
  return value === "none" || value === "device" || value === "human" || value === "device_or_human";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function canonicalizeTrust(trust: MeshForwardTrustMetadata | undefined): string {
  if (!trust) {
    return "";
  }

  const normalized: Record<string, unknown> = {};
  for (const key of TRUST_KEYS) {
    const value = trust[key];
    if (Array.isArray(value)) {
      normalized[key] = [...value].sort();
      continue;
    }
    if (value !== undefined) {
      normalized[key] = value;
    }
  }
  return JSON.stringify(normalized);
}

export function createClawMeshCommandEnvelope(
  params: CreateClawMeshCommandEnvelopeParams,
): ClawMeshCommandEnvelopeV1 {
  return {
    version: 1,
    kind: "clawmesh.command",
    commandId: params.commandId ?? randomUUID(),
    createdAtMs: params.createdAtMs ?? Date.now(),
    source: params.source,
    target: params.target,
    operation: params.operation,
    trust: params.trust,
    note: params.note,
  };
}

export function validateClawMeshCommandEnvelope(
  envelope: unknown,
): envelope is ClawMeshCommandEnvelopeV1 {
  if (!isRecord(envelope)) {
    return false;
  }
  if (envelope.version !== 1 || envelope.kind !== "clawmesh.command") {
    return false;
  }
  if (typeof envelope.commandId !== "string" || envelope.commandId.length === 0) {
    return false;
  }
  if (typeof envelope.createdAtMs !== "number") {
    return false;
  }
  if (!isRecord(envelope.target) || typeof envelope.target.ref !== "string" || typeof envelope.target.kind !== "string") {
    return false;
  }
  if (!isRecord(envelope.operation) || typeof envelope.operation.name !== "string") {
    return false;
  }
  if (!isRecord(envelope.trust)) {
    return false;
  }
  const trust = envelope.trust as Record<string, unknown>;
  if (
    (trust.action_type !== "communication" &&
      trust.action_type !== "observation" &&
      trust.action_type !== "actuation") ||
    !isKnownTrustTier(trust.evidence_trust_tier) ||
    !isKnownTrustTier(trust.minimum_trust_tier) ||
    !isKnownVerificationRequirement(trust.verification_required)
  ) {
    return false;
  }
  return true;
}

export function resolveMeshForwardTrustMetadata(payload: MeshForwardPayload): ResolveTrustResult {
  const envelope = payload.command;
  if (!envelope) {
    return { ok: true, trust: payload.trust };
  }

  if (!validateClawMeshCommandEnvelope(envelope)) {
    return {
      ok: false,
      code: "INVALID_COMMAND_ENVELOPE",
      message: "invalid clawmesh command envelope in mesh forward payload",
    };
  }

  if (payload.trust) {
    const topLevel = canonicalizeTrust(payload.trust);
    const fromEnvelope = canonicalizeTrust(envelope.trust);
    if (topLevel !== fromEnvelope) {
      return {
        ok: false,
        code: "TRUST_ENVELOPE_MISMATCH",
        message: "top-level trust metadata does not match command envelope trust metadata",
      };
    }
  }

  return { ok: true, trust: envelope.trust };
}

export function buildClawMeshForwardPayload(params: {
  to: string;
  originGatewayId: string;
  idempotencyKey: string;
  command: CreateClawMeshCommandEnvelopeParams;
  message?: string;
}): MeshForwardPayload {
  const command = createClawMeshCommandEnvelope(params.command);
  return {
    channel: "clawmesh",
    to: params.to,
    message: params.message,
    originGatewayId: params.originGatewayId,
    idempotencyKey: params.idempotencyKey,
    command,
    trust: command.trust,
  };
}
