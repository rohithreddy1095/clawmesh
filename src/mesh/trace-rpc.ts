/**
 * Trace RPC handler — exposes CorrelationTracker via mesh.trace RPC.
 *
 * Allows remote nodes and dashboard tools to query causal chains:
 *   mesh.trace { frameId: "f-001" }        → get specific chain
 *   mesh.trace { stage: "proposal.created" } → find chains with proposals
 *   mesh.trace {}                           → list recent chains
 */

import type { RpcHandlerFn, RpcHandlerMap } from "./rpc-dispatcher.js";
import type { CorrelationTracker } from "./correlation-tracker.js";

export function createTraceHandlers(deps: {
  correlationTracker: CorrelationTracker;
}): RpcHandlerMap {
  return {
    "mesh.trace": (({ params, respond }) => {
      if (typeof params.frameId === "string") {
        const chain = deps.correlationTracker.get(params.frameId);
        if (chain) {
          respond(true, {
            chain,
            formatted: deps.correlationTracker.formatChain(params.frameId),
          });
        } else {
          respond(true, { chain: null, message: "No chain found for this frame ID" });
        }
        return;
      }

      if (typeof params.stage === "string") {
        const chains = deps.correlationTracker.findByStage(params.stage);
        respond(true, {
          chains: chains.slice(0, 20),
          total: chains.length,
        });
        return;
      }

      // Default: return summary
      respond(true, {
        trackedChains: deps.correlationTracker.size,
      });
    }) as RpcHandlerFn,
  };
}
