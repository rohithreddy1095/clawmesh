import type { DeviceIdentity } from "../../infra/device-identity.js";
import type { MeshForwardPayload } from "../types.js";

/**
 * Type alias for gateway request handler map.
 * Locally defined to avoid pulling in the full (stripped) gateway types.
 */
type HandlerFn = (opts: {
  params: Record<string, unknown>;
  respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void;
}) => void | Promise<void>;
type Handlers = Record<string, HandlerFn>;

/**
 * Handler for mesh.message.forward — receives a forwarded message from a mesh peer.
 *
 * In ClawMesh, message delivery is mesh-only (no channel plugins).
 * The handler validates the payload and emits an event for local processing.
 */
export function createMeshForwardHandlers(deps: {
  identity: DeviceIdentity;
  onForward?: (payload: MeshForwardPayload) => void | Promise<void>;
}): Handlers {
  return {
    "mesh.message.forward": async ({ params, respond }) => {
      const p = params as unknown as MeshForwardPayload;
      if (!p || !p.channel || !p.to || !p.originGatewayId) {
        respond(false, undefined, {
          code: "INVALID_PARAMS",
          message: "missing required forward params (channel, to, originGatewayId)",
        });
        return;
      }

      // Loop prevention: reject if the origin is ourselves.
      if (p.originGatewayId === deps.identity.deviceId) {
        respond(false, undefined, {
          code: "LOOP_DETECTED",
          message: "message originated from this gateway; rejecting to prevent loop",
        });
        return;
      }

      try {
        if (deps.onForward) {
          await deps.onForward(p);
        }

        const messageId = `mesh-fwd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        respond(true, {
          messageId,
          channel: p.channel,
        });
      } catch (err) {
        respond(false, undefined, {
          code: "DELIVERY_FAILED",
          message: String(err),
        });
      }
    },
  };
}
