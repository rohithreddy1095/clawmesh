/**
 * Events RPC handler — exposes SystemEventLog via mesh.events RPC.
 *
 * Allows remote nodes and dashboard tools to query the event log:
 *   mesh.events { limit?: number, type?: string, sinceMs?: number }
 *
 * This is the "what happened?" endpoint for debugging.
 */

import type { RpcHandlerFn, RpcHandlerMap } from "./rpc-dispatcher.js";
import type { SystemEventLog, SystemEventType } from "./system-event-log.js";

export type EventsRpcDeps = {
  eventLog: SystemEventLog;
};

/**
 * Create the mesh.events RPC handler.
 */
export function createEventsHandlers(deps: EventsRpcDeps): RpcHandlerMap {
  return {
    "mesh.events": (({ params, respond }) => {
      const limit = typeof params.limit === "number" ? Math.min(params.limit, 200) : 50;

      let events;
      if (typeof params.type === "string") {
        events = deps.eventLog.byType(params.type as SystemEventType, limit);
      } else if (typeof params.sinceMs === "number") {
        events = deps.eventLog.since(params.sinceMs).slice(-limit);
      } else {
        events = deps.eventLog.recent(limit);
      }

      const summary = deps.eventLog.summary(60);

      respond(true, {
        events,
        summary,
        total: deps.eventLog.size,
      });
    }) as RpcHandlerFn,
  };
}
