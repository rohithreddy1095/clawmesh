/**
 * PiSession broadcast helpers — extracted from PiSession for testability.
 *
 * Pure helper functions for constructing agent response frames
 * and gossip patterns for mesh broadcast.
 */

import type { ContextFrame } from "../mesh/context-types.js";

export interface AgentResponseData {
  conversationId?: string;
  requestId?: string;
  message: string;
  status: "complete" | "queued" | "thinking" | "error";
  proposals?: string[];
  citations?: Array<{ metric: string; value: unknown; zone?: string; timestamp: number }>;
}

/**
 * Build a context frame for an agent response broadcast.
 */
export function buildAgentResponseFrame(
  data: AgentResponseData,
  sourceDeviceId: string,
  sourceDisplayName: string,
): ContextFrame {
  return {
    kind: "agent_response" as any,
    frameId: `ar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId,
    sourceDisplayName,
    timestamp: Date.now(),
    data: data as unknown as Record<string, unknown>,
    trust: { evidence_sources: ["llm"], evidence_trust_tier: "T0_planning_inference" },
  };
}

export interface PatternExport {
  triggerCondition: string;
  action: { operation: string; targetRef: string };
  confidence: number;
  approvalCount: number;
  rejectionCount: number;
}

/**
 * Build a gossip frame for learned patterns.
 */
export function buildPatternGossipFrame(
  patterns: PatternExport[],
): {
  kind: "capability_update";
  data: { type: string; patterns: PatternExport[] };
  trust: { evidence_sources: string[]; evidence_trust_tier: string };
  note: string;
} {
  return {
    kind: "capability_update",
    data: {
      type: "learned_patterns",
      patterns,
    },
    trust: {
      evidence_sources: ["human", "llm"],
      evidence_trust_tier: "T2_operational_observation",
    },
    note: `${patterns.length} learned patterns from operator decisions`,
  };
}

/**
 * Build an error response for agent failures.
 */
export function buildErrorResponse(
  conversationId: string | undefined,
  requestId: string | undefined,
  error: string,
): AgentResponseData | null {
  if (!conversationId) return null;
  return {
    conversationId,
    requestId,
    message: error,
    status: "error",
  };
}

/**
 * Build a rate-limit response message.
 */
export function buildRateLimitResponse(
  conversationId: string | undefined,
  requestId: string | undefined,
): AgentResponseData | null {
  if (!conversationId) return null;
  return {
    conversationId,
    requestId,
    message: "I'm having trouble responding right now. The system may be rate-limited. Please try again shortly.",
    status: "error",
  };
}
