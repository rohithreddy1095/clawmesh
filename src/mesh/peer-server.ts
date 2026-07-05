import { randomUUID } from "node:crypto";
import type { DeviceIdentity } from "../infra/device-identity.js";
import { ChallengeStore } from "./challenge-store.js";
import { buildMeshConnectAuth, verifyMeshConnectAuth } from "./handshake.js";
import type { PeerRegistry } from "./peer-registry.js";
import { isTrustedPeer, getTrustedPeer } from "./peer-trust.js";
import type { MeshConnectParams, MeshNodeRole, PeerSession } from "./types.js";
import type { WebSocket } from "ws";

type HandlerFn = (opts: {
  req: Record<string, unknown>;
  params: Record<string, unknown>;
  respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void;
}) => void | Promise<void>;
type GatewayRequestHandlers = Record<string, HandlerFn>;

export type MeshServerHandlerDeps = {
  identity: DeviceIdentity;
  peerRegistry: PeerRegistry;
  displayName?: string;
  capabilities?: string[];
  meshId?: string;
  role?: MeshNodeRole;
  onPeerConnected?: (session: PeerSession) => void;
  /** Injectable for tests; a fresh store is created if omitted. */
  challengeStore?: ChallengeStore;
};

/**
 * Create gateway request handlers for inbound mesh peer connections.
 *
 * Handshake sequence (v2):
 *   1. Client → mesh.challenge          → server issues single-use nonce
 *   2. Client → mesh.connect (signed over nonce, carries clientNonce)
 *   3. Server verifies nonce + signature, responds signed over clientNonce
 */
export function createMeshServerHandlers(deps: MeshServerHandlerDeps): GatewayRequestHandlers {
  const challenges = deps.challengeStore ?? new ChallengeStore();

  return {
    "mesh.challenge": ({ respond, req }) => {
      const connId = (req as { _connId?: string })._connId ?? randomUUID();
      const nonce = challenges.issue(connId);
      respond(true, { nonce });
    },

    "mesh.connect": async ({ params, respond, req }) => {
      const p = params as unknown as MeshConnectParams;
      if (!p || !p.deviceId || !p.publicKey || !p.signature || !p.signedAtMs) {
        respond(false, undefined, {
          code: "INVALID_PARAMS",
          message: "missing required mesh.connect params",
        });
        return;
      }
      if (typeof p.clientNonce !== "string" || !p.clientNonce) {
        respond(false, undefined, {
          code: "INVALID_PARAMS",
          message: "missing clientNonce for mutual authentication",
        });
        return;
      }

      // The nonce must be one WE issued for THIS connection, unconsumed and fresh.
      const connId = (req as { _connId?: string })._connId ?? randomUUID();
      if (!p.nonce) {
        respond(false, undefined, {
          code: "AUTH_NONCE_REQUIRED",
          message: "mesh.connect requires a server-issued nonce; call mesh.challenge first",
        });
        return;
      }
      if (!challenges.consume(connId, p.nonce)) {
        respond(false, undefined, {
          code: "AUTH_NONCE_INVALID",
          message: "nonce was not issued for this connection, already used, or expired",
        });
        return;
      }

      // Verify the peer is in our trust store.
      const trustedPeer = await getTrustedPeer(p.deviceId);
      if (!trustedPeer) {
        respond(false, undefined, {
          code: "UNTRUSTED_PEER",
          message: `peer ${p.deviceId} is not in the trust store`,
        });
        return;
      }

      // If the trust store has a pinned public key, verify it matches.
      if (trustedPeer.publicKey && trustedPeer.publicKey !== p.publicKey) {
        respond(false, undefined, {
          code: "PUBLIC_KEY_MISMATCH",
          message: `peer ${p.deviceId} public key does not match trust store`,
        });
        return;
      }

      // Verify the peer's Ed25519 signature over the nonce we issued.
      const valid = verifyMeshConnectAuth({
        deviceId: p.deviceId,
        publicKey: p.publicKey,
        signature: p.signature,
        signedAtMs: p.signedAtMs,
        nonce: p.nonce,
        meshId: p.meshId,
        role: p.role,
        requiredNonce: p.nonce,
      });
      if (!valid) {
        respond(false, undefined, {
          code: "AUTH_FAILED",
          message: "mesh peer signature verification failed",
        });
        return;
      }

      if (deps.meshId && p.meshId && deps.meshId !== p.meshId) {
        respond(false, undefined, {
          code: "MESH_ID_MISMATCH",
          message: `peer belongs to mesh ${p.meshId}, expected ${deps.meshId}`,
        });
        return;
      }

      // Build our own signed response for mutual authentication.
      // We sign over the CLIENT's nonce so our response cannot be replayed either.
      const ourAuth = buildMeshConnectAuth({
        identity: deps.identity,
        nonce: p.clientNonce,
        displayName: deps.displayName,
        capabilities: deps.capabilities,
        meshId: deps.meshId,
        role: deps.role,
      });

      // Register the peer session.
      // The actual WebSocket is managed by the gateway WS infrastructure,
      // but we need to associate it with this peer for RPC routing.
      // In a real implementation, we'd get the WS from the request context.
      // For now, we register with a placeholder that the manager will update.
      const socket = (req as { _socket?: WebSocket })._socket;
      const session: PeerSession = {
        deviceId: p.deviceId,
        connId,
        displayName: p.displayName,
        publicKey: p.publicKey,
        socket: (socket ?? (null as unknown)) as PeerSession["socket"],
        outbound: false,
        capabilities: p.capabilities ?? [],
        role: p.role,
        connectedAtMs: Date.now(),
      };
      deps.peerRegistry.register(session);
      deps.onPeerConnected?.(session);

      respond(true, {
        deviceId: ourAuth.deviceId,
        publicKey: ourAuth.publicKey,
        signature: ourAuth.signature,
        signedAtMs: ourAuth.signedAtMs,
        nonce: ourAuth.nonce,
        displayName: ourAuth.displayName,
        capabilities: ourAuth.capabilities,
        meshId: ourAuth.meshId,
        role: ourAuth.role,
      });
    },
  };
}
