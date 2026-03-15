/**
 * Context Sync RPC handler — responds to context.sync requests from joining peers.
 *
 * When a peer calls `context.sync`, this handler queries the local world model
 * and returns matching frames so the peer can catch up on missed context.
 */

import type { WorldModel } from "../world-model.js";
import { handleContextSyncRequest, type ContextSyncRequest } from "../context-sync.js";

type HandlerFn = (opts: {
  params: Record<string, unknown>;
  respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void;
}) => void | Promise<void>;
type GatewayRequestHandlers = Record<string, HandlerFn>;

export function createContextSyncHandlers(deps: {
  worldModel: WorldModel;
}): GatewayRequestHandlers {
  return {
    "context.sync": ({ params, respond }) => {
      const since = typeof params.since === "number" ? params.since : 0;
      const limit = typeof params.limit === "number" ? params.limit : 100;
      const kind = typeof params.kind === "string" ? params.kind : undefined;
      const zone = typeof params.zone === "string" ? params.zone : undefined;

      const request: ContextSyncRequest = { since, limit, kind, zone };
      const response = handleContextSyncRequest(deps.worldModel, request);

      respond(true, response);
    },
  };
}
