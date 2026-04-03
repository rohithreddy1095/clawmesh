/**
 * MessageRouter — routes inbound WebSocket messages to the appropriate handler.
 *
 * Extracted from MeshNodeRuntime.handleInboundMessage to separate:
 *   - JSON parsing + validation
 *   - Event routing (context.frame → propagator → world model)
 *   - Intent detection (mesh.message.forward → intent router)
 *   - RPC response routing (→ peer registry)
 *   - RPC request dispatch (→ rpc dispatcher)
 *
 * This is the single entry point for all inbound WebSocket messages.
 */

import type { WebSocket } from "ws";
import type { ContextFrame } from "./context-types.js";
import type { ContextPropagator } from "./context-propagator.js";
import type { WorldModel } from "./world-model.js";
import type { PeerRegistry } from "./peer-registry.js";
import type { RpcDispatcher } from "./rpc-dispatcher.js";
import type { MeshEventBus } from "./event-bus.js";
import { extractIntentFromForward, routeIntent, type IntentRouterDeps } from "./intent-router.js";
import { NODE_PROTOCOL_GENERATION } from "./protocol.js";

// ─── Types ──────────────────────────────────────────────────

export type MessageRouterDeps = {
  peerRegistry: PeerRegistry;
  contextPropagator: ContextPropagator;
  worldModel: WorldModel;
  eventBus: MeshEventBus;
  rpcDispatcher: RpcDispatcher;
  intentRouterDeps: IntentRouterDeps;
};

export type MessageRouteResult =
  | { handled: true; kind: "context_frame" | "intent" | "rpc_response" | "rpc_request" }
  | { handled: false; reason: string };

// ─── Router ─────────────────────────────────────────────────

/**
 * Route an inbound WebSocket message to the appropriate handler.
 *
 * Returns whether the message was handled and what kind it was.
 */
export async function routeInboundMessage(
  raw: string,
  socket: WebSocket,
  connId: string,
  deps: MessageRouterDeps,
): Promise<MessageRouteResult> {
  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { handled: false, reason: "invalid_json" };
  }

  if (!parsed || typeof parsed !== "object") {
    return { handled: false, reason: "not_object" };
  }

  const frame = parsed as Record<string, unknown>;

  // ─── Context frame events ─────────────────
  if (frame.type === "event" && frame.event === "context.frame") {
    const contextFrame = frame.payload as ContextFrame;
    if (contextFrame.gen !== undefined && contextFrame.gen !== NODE_PROTOCOL_GENERATION) {
      return { handled: false, reason: "bad_generation" };
    }
    const senderSession = deps.peerRegistry.getByConnId(connId);
    const fromDeviceId = senderSession?.deviceId ?? contextFrame.sourceDeviceId;
    const isNew = deps.contextPropagator.handleInbound(contextFrame, fromDeviceId);
    if (isNew) {
      deps.worldModel.ingest(contextFrame);
      deps.eventBus.emit("context.frame.ingested", { frame: contextFrame });
    }
    return { handled: true, kind: "context_frame" };
  }

  // ─── Intent detection on forward requests ──
  if (frame.type === "req" && frame.method === "mesh.message.forward") {
    const fwdParams = (frame.params ?? {}) as Record<string, unknown>;
    const intent = extractIntentFromForward(fwdParams);
    if (intent) {
      routeIntent(intent, deps.intentRouterDeps);
      return { handled: true, kind: "intent" };
    }
    // Not an intent — fall through to normal RPC dispatch
  }

  // ─── Type gate ────────────────────────────
  if (!("type" in frame)) {
    return { handled: false, reason: "no_type_field" };
  }

  // ─── RPC responses ────────────────────────
  if (frame.type === "res") {
    if (typeof frame.id !== "string" || typeof frame.ok !== "boolean") {
      return { handled: false, reason: "invalid_response" };
    }
    deps.peerRegistry.handleRpcResult({
      id: frame.id,
      ok: frame.ok,
      payload: frame.payload,
      error:
        frame.error && typeof frame.error === "object"
          ? (frame.error as { code?: string; message?: string })
          : null,
    });
    return { handled: true, kind: "rpc_response" };
  }

  // ─── RPC requests ─────────────────────────
  if (frame.type !== "req") {
    return { handled: false, reason: "unknown_type" };
  }
  if (typeof frame.id !== "string" || typeof frame.method !== "string") {
    return { handled: false, reason: "invalid_request" };
  }

  await deps.rpcDispatcher.dispatch(socket, connId, {
    type: "req",
    id: frame.id,
    method: frame.method,
    params:
      frame.params && typeof frame.params === "object"
        ? (frame.params as Record<string, unknown>)
        : {},
  });
  return { handled: true, kind: "rpc_request" };
}
