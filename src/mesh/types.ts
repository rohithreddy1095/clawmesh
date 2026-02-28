import type { WebSocket } from "ws";

export type PeerSession = {
  /** Remote peer's device ID (SHA256 of Ed25519 public key). */
  deviceId: string;
  /** WebSocket connection ID (unique per connection). */
  connId: string;
  /** Remote peer's display name. */
  displayName?: string;
  /** Remote peer's public key in PEM or base64url format. */
  publicKey?: string;
  /** The WebSocket instance for this peer connection. */
  socket: WebSocket;
  /** Whether this side initiated the connection (outbound). */
  outbound: boolean;
  /** Capabilities advertised by the remote peer. */
  capabilities: string[];
  /** Timestamp when this peer connected. */
  connectedAtMs: number;
};

export type MeshForwardPayload = {
  /** Channel to deliver the message to (e.g. "telegram", "whatsapp"). */
  channel: string;
  /** Recipient identifier on the target channel. */
  to: string;
  /** Text message content. */
  message?: string;
  /** Media URL to attach. */
  mediaUrl?: string;
  /** Multiple media URLs. */
  mediaUrls?: string[];
  /** Account ID on the target channel. */
  accountId?: string;
  /** The gateway that originated this forward (for loop prevention). */
  originGatewayId: string;
  /** Idempotency key to deduplicate. */
  idempotencyKey: string;
  /** Optional structured command envelope for ClawMesh control-plane messages. */
  command?: ClawMeshCommandEnvelopeV1;
  /** Optional trust metadata for runtime actuation gating. */
  trust?: MeshForwardTrustMetadata;
};

export type MeshTrustTier =
  | "T0_planning_inference"
  | "T1_unverified_observation"
  | "T2_operational_observation"
  | "T3_verified_action_evidence";

export type MeshVerificationRequired = "none" | "device" | "human" | "device_or_human";

export type MeshEvidenceSource = "llm" | "sensor" | "device" | "human" | "mixed";

/**
 * Wire-level trust metadata intentionally uses snake_case to match the farm twin policy files.
 */
export type MeshForwardTrustMetadata = {
  /** Declares the operational intent for policy enforcement. */
  action_type?: "communication" | "observation" | "actuation";
  /** Trust tier of evidence that produced this command. */
  evidence_trust_tier?: MeshTrustTier;
  /** Minimum trust tier required before execution. */
  minimum_trust_tier?: MeshTrustTier;
  /** Verification requirement for execution. */
  verification_required?: MeshVerificationRequired;
  /** Whether required verification has already been satisfied upstream. */
  verification_satisfied?: boolean;
  /** Sources used to produce the command (e.g. ["sensor", "human"]). */
  evidence_sources?: MeshEvidenceSource[];
  /** Human/device identities that approved or verified execution. */
  approved_by?: string[];
};

export type ClawMeshCommandEnvelopeV1 = {
  version: 1;
  kind: "clawmesh.command";
  /** Globally unique command identifier for tracking and reconciliation. */
  commandId: string;
  /** Envelope creation time on the sending node. */
  createdAtMs: number;
  /** Who created the command (e.g. "mac-claw", "jetson-claw"). */
  source?: {
    nodeId?: string;
    role?: string;
  };
  /** Intended destination or capability. */
  target: {
    kind: "capability" | "device" | "peer" | "task";
    ref: string;
  };
  /** Operation to perform. */
  operation: {
    name: string;
    params?: Record<string, unknown>;
  };
  /** Trust policy attached to the command envelope (source of truth for actuation). */
  trust: MeshForwardTrustMetadata & {
    action_type: "communication" | "observation" | "actuation";
    evidence_trust_tier: MeshTrustTier;
    minimum_trust_tier: MeshTrustTier;
    verification_required: MeshVerificationRequired;
  };
  /** Optional human-readable notes for operators and audit trails. */
  note?: string;
};

export type MeshCapabilities = {
  /** Channel IDs this gateway can deliver to. */
  channels: string[];
  /** Skill IDs available on this gateway. */
  skills: string[];
  /** Platform identifier (e.g. "darwin", "linux"). */
  platform: string;
};

export type MeshConnectParams = {
  /** Protocol version. */
  version: 1;
  /** Connecting peer's device ID. */
  deviceId: string;
  /** Connecting peer's public key (base64url of raw Ed25519). */
  publicKey: string;
  /** Signature of the auth payload. */
  signature: string;
  /** Timestamp when the signature was created (ms). */
  signedAtMs: number;
  /** Challenge nonce received from the server. */
  nonce?: string;
  /** Display name. */
  displayName?: string;
  /** Capabilities offered by this peer. */
  capabilities?: string[];
};

export type MeshConnectResult = {
  /** Accepted: the server's own device ID. */
  deviceId: string;
  /** Server's public key (base64url). */
  publicKey: string;
  /** Server's signature over the mutual auth payload. */
  signature: string;
  /** Server's signed-at timestamp. */
  signedAtMs: number;
  /** Server's display name. */
  displayName?: string;
  /** Server's capabilities. */
  capabilities?: string[];
};
