/**
 * ActuationSender — validates trust policy and forwards actuation commands.
 *
 * Extracted from MeshNodeRuntime.sendMockActuation to separate:
 *   - Trust metadata defaults
 *   - Sender-side trust evaluation (early rejection)
 *   - Trust audit recording
 *   - Command envelope construction + forwarding
 */

import { forwardMessageToPeer } from "./forwarding.js";
import { evaluateMeshForwardTrust } from "./trust-policy.js";
import type { PeerRegistry } from "./peer-registry.js";
import type { TrustAuditTrail } from "./trust-audit.js";
import type {
  ClawMeshCommandEnvelopeV1,
  MeshForwardPayload,
  MeshForwardTrustMetadata,
} from "./types.js";

// ─── Types ──────────────────────────────────────────────────

export type ActuationParams = {
  peerDeviceId: string;
  targetRef: string;
  operation: string;
  operationParams?: Record<string, unknown>;
  note?: string;
  trust?: MeshForwardTrustMetadata;
};

export type ActuationDeps = {
  peerRegistry: PeerRegistry;
  deviceId: string;
  trustAudit?: TrustAuditTrail;
  log?: { warn: (msg: string) => void };
};

export type ActuationResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};

// ─── Default Trust ──────────────────────────────────────────

export function defaultActuationTrust(): MeshForwardTrustMetadata {
  return {
    action_type: "actuation",
    evidence_sources: ["sensor", "human"],
    evidence_trust_tier: "T3_verified_action_evidence",
    minimum_trust_tier: "T2_operational_observation",
    verification_required: "human",
    verification_satisfied: true,
    approved_by: ["operator:local-cli"],
  };
}

// ─── Sender ─────────────────────────────────────────────────

/**
 * Validate trust and forward an actuation command to a peer.
 *
 * Performs sender-side trust evaluation BEFORE sending over the wire,
 * catching policy violations early (e.g. LLM-only actuation).
 */
export async function sendActuation(
  params: ActuationParams,
  deps: ActuationDeps,
): Promise<ActuationResult> {
  const trust = (params.trust ?? defaultActuationTrust()) as ClawMeshCommandEnvelopeV1["trust"];

  // Sender-side trust evaluation
  const senderPayload: MeshForwardPayload = {
    channel: "clawmesh",
    to: params.targetRef,
    originGatewayId: deps.deviceId,
    idempotencyKey: "",
    trust,
  };

  const trustDecision = evaluateMeshForwardTrust(senderPayload);
  deps.trustAudit?.record(senderPayload, trustDecision);

  if (!trustDecision.ok) {
    deps.log?.warn(
      `mesh: sender-side trust rejection: ${trustDecision.code} — ${trustDecision.message}`,
    );
    return {
      ok: false,
      error: `trust policy: ${trustDecision.code} — ${trustDecision.message}`,
    };
  }

  return await forwardMessageToPeer({
    peerRegistry: deps.peerRegistry,
    peerDeviceId: params.peerDeviceId,
    channel: "clawmesh",
    to: params.targetRef,
    message: params.note,
    originGatewayId: deps.deviceId,
    commandDraft: {
      source: {
        nodeId: deps.deviceId,
        role: "planner",
      },
      target: {
        kind: "capability",
        ref: params.targetRef,
      },
      operation: {
        name: params.operation,
        params: params.operationParams,
      },
      trust,
      note: params.note,
    },
  });
}
