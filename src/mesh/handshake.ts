import {
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
  verifyDeviceSignature,
} from "../infra/device-identity.js";
import type { DeviceIdentity } from "../infra/device-identity.js";

/**
 * Mesh auth payload — version 2.
 *
 * Format: "mesh.connect|v2|deviceId|signedAtMs|nonce|meshId|role"
 *
 * All seven fields are ALWAYS present, in fixed positions; absent optional
 * fields are encoded as the empty string. Every variable field is
 * URI-component-encoded so a field value can never contain the `|` delimiter.
 *
 * v1 joined only the fields that were present, so `{nonce:"x"}` and
 * `{meshId:"x"}` signed identical strings (field-position ambiguity), and a
 * value containing `|` could forge adjacent fields (delimiter injection).
 * v2 eliminates both classes by construction.
 */
export const MESH_AUTH_VERSION = "v2";

function encodeField(value: string): string {
  return encodeURIComponent(value);
}

export function buildMeshAuthPayload(params: {
  deviceId: string;
  signedAtMs: number;
  /** Server-issued challenge nonce (or the peer's clientNonce when signing a response). */
  nonce: string;
  meshId?: string;
  role?: string;
}): string {
  return [
    "mesh.connect",
    MESH_AUTH_VERSION,
    encodeField(params.deviceId),
    String(params.signedAtMs),
    encodeField(params.nonce ?? ""),
    encodeField(params.meshId ?? ""),
    encodeField(params.role ?? ""),
  ].join("|");
}

/**
 * Create signed mesh connect params from a device identity.
 * `nonce` is the challenge issued by the verifying side and is mandatory.
 */
export function buildMeshConnectAuth(params: {
  identity: DeviceIdentity;
  nonce: string;
  displayName?: string;
  capabilities?: string[];
  meshId?: string;
  role?: string;
}): {
  deviceId: string;
  publicKey: string;
  signature: string;
  signedAtMs: number;
  nonce: string;
  displayName?: string;
  capabilities?: string[];
  meshId?: string;
  role?: string;
} {
  const signedAtMs = Date.now();
  const payload = buildMeshAuthPayload({
    deviceId: params.identity.deviceId,
    signedAtMs,
    nonce: params.nonce,
    meshId: params.meshId,
    role: params.role,
  });
  const signature = signDevicePayload(params.identity.privateKeyPem, payload);
  return {
    deviceId: params.identity.deviceId,
    publicKey: publicKeyRawBase64UrlFromPem(params.identity.publicKeyPem),
    signature,
    signedAtMs,
    nonce: params.nonce,
    displayName: params.displayName,
    capabilities: params.capabilities,
    meshId: params.meshId,
    role: params.role,
  };
}

/**
 * Verify a mesh connect auth payload from a remote peer.
 *
 * Requirements enforced here (all must hold):
 *   1. `nonce` is present and equals `requiredNonce` — the nonce the
 *      verifying side itself issued. This is what prevents replay.
 *   2. `signedAtMs` is within the clock-drift window (5 minutes).
 *   3. The Ed25519 signature is valid over the v2 fixed-position payload.
 */
export function verifyMeshConnectAuth(params: {
  deviceId: string;
  publicKey: string;
  signature: string;
  signedAtMs: number;
  nonce?: string;
  meshId?: string;
  role?: string;
  /** The nonce the verifier issued; auth must have been signed over exactly this. */
  requiredNonce: string;
}): boolean {
  if (!params.requiredNonce) {
    return false;
  }
  if (!params.nonce || params.nonce !== params.requiredNonce) {
    return false;
  }
  const MAX_CLOCK_DRIFT_MS = 5 * 60 * 1000;
  const now = Date.now();
  if (Math.abs(now - params.signedAtMs) > MAX_CLOCK_DRIFT_MS) {
    return false;
  }
  const payload = buildMeshAuthPayload({
    deviceId: params.deviceId,
    signedAtMs: params.signedAtMs,
    nonce: params.nonce,
    meshId: params.meshId,
    role: params.role,
  });
  return verifyDeviceSignature(params.publicKey, payload, params.signature);
}
