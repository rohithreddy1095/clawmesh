import {
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
  verifyDeviceSignature,
} from "../infra/device-identity.js";
import type { DeviceIdentity } from "../infra/device-identity.js";

/**
 * Build the mesh auth payload string for signing/verification.
 * Format: "mesh.connect|v1|deviceId|signedAtMs|nonce?|meshId?|role?"
 */
export function buildMeshAuthPayload(params: {
  deviceId: string;
  signedAtMs: number;
  nonce?: string;
  meshId?: string;
  role?: string;
}): string {
  const parts = ["mesh.connect", "v1", params.deviceId, String(params.signedAtMs)];
  if (params.nonce) {
    parts.push(params.nonce);
  }
  if (params.meshId) {
    parts.push(params.meshId);
  }
  if (params.role) {
    parts.push(params.role);
  }
  return parts.join("|");
}

/**
 * Create signed mesh connect params from a device identity.
 */
export function buildMeshConnectAuth(params: {
  identity: DeviceIdentity;
  nonce?: string;
  displayName?: string;
  capabilities?: string[];
  meshId?: string;
  role?: string;
}): {
  deviceId: string;
  publicKey: string;
  signature: string;
  signedAtMs: number;
  nonce?: string;
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
 * Returns true if the signature is valid and the timestamp is recent (within 5 minutes).
 */
export function verifyMeshConnectAuth(params: {
  deviceId: string;
  publicKey: string;
  signature: string;
  signedAtMs: number;
  nonce?: string;
  meshId?: string;
  role?: string;
}): boolean {
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
