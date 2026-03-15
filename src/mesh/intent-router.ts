/**
 * IntentRouter — routes operator intents to the planner or mock handler.
 *
 * Extracted from MeshNodeRuntime.handleInboundMessage to separate the
 * intelligence routing concern from the generic message dispatch.
 *
 * The intent router:
 *   1. Detects intent:parse operations in mesh.message.forward requests
 *   2. Broadcasts human_input context frames
 *   3. Routes to PiSession (real planner) or mock fallback
 */

import { randomUUID } from "node:crypto";
import type { ContextPropagator } from "./context-propagator.js";

// ─── Types ──────────────────────────────────────────────────

export type IntentParseRequest = {
  text: string;
  conversationId: string;
  requestId: string;
};

export type IntentRouterDeps = {
  deviceId: string;
  displayName?: string;
  contextPropagator: ContextPropagator;
  broadcastToUI: (event: string, payload: unknown) => void;
  /** If set, routes to real planner. If null, uses mock fallback. */
  handlePlannerIntent?: (text: string, opts: { conversationId: string; requestId: string }) => void;
  log: { info: (msg: string) => void };
};

// ─── Extract intent from forward request params ─────────────

/**
 * Try to extract an intent:parse operation from a mesh.message.forward request.
 * Returns null if the request is not an intent parse operation.
 */
export function extractIntentFromForward(
  params: Record<string, unknown>,
): IntentParseRequest | null {
  if (params.to !== "agent:pi" || params.channel !== "clawmesh") {
    return null;
  }

  const cmd = params.commandDraft as Record<string, unknown> | undefined;
  const operation = cmd?.operation as Record<string, unknown> | undefined;
  if (operation?.name !== "intent:parse") {
    return null;
  }

  const opParams = operation.params as Record<string, unknown> | undefined;
  const text = String(opParams?.text ?? "Unknown intent");
  const conversationId = String(opParams?.conversationId ?? randomUUID());
  const requestId = randomUUID();

  return { text, conversationId, requestId };
}

// ─── Route the intent ───────────────────────────────────────

/**
 * Route an extracted intent to the planner or mock fallback.
 * Broadcasts human_input context and handles the response path.
 */
export function routeIntent(
  intent: IntentParseRequest,
  deps: IntentRouterDeps,
): void {
  const { text, conversationId, requestId } = intent;

  // Broadcast human input context
  deps.contextPropagator.broadcastHumanInput({
    data: { intent: text, conversationId, requestId },
    note: "Operator submitted intent",
  });

  if (deps.handlePlannerIntent) {
    // Real planner available
    deps.log.info(`[pi-planner] Operator intent: "${text}" (conv=${conversationId.slice(0, 8)})`);
    deps.handlePlannerIntent(text, { conversationId, requestId });
  } else {
    // Mock fallback
    deps.log.info(`[mock-pi] Received natural language intent: "${text}"`);

    // Send thinking status
    deps.broadcastToUI("context.frame", {
      kind: "agent_response",
      frameId: randomUUID(),
      sourceDeviceId: deps.deviceId,
      sourceDisplayName: deps.displayName,
      timestamp: Date.now(),
      data: { conversationId, requestId, message: "", status: "thinking" },
      trust: { evidence_sources: ["llm"], evidence_trust_tier: "T0_planning_inference" },
    });

    // Send mock response after delay
    setTimeout(() => {
      deps.broadcastToUI("context.frame", {
        kind: "agent_response",
        frameId: randomUUID(),
        sourceDeviceId: deps.deviceId,
        sourceDisplayName: deps.displayName,
        timestamp: Date.now(),
        data: {
          conversationId,
          requestId,
          message: `I received your intent: "${text}". This is a simulated response — enable the Pi planner (--pi-planner) for real intelligence.`,
          status: "complete",
        },
        trust: { evidence_sources: ["llm"], evidence_trust_tier: "T0_planning_inference" },
      });
    }, 2000);
  }
}
