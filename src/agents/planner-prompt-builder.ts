/**
 * PlannerPromptBuilder — constructs prompts for the Pi planner LLM cycle.
 *
 * Extracted from PiSession.runCycle() for testability.
 * Handles:
 * - Operator intent prompt formatting
 * - System trigger prompt formatting
 * - Pattern memory context injection
 * - Sensor citation extraction from world model frames
 */

import type { ContextFrame } from "../mesh/context-types.js";

export interface TriggerEntry {
  reason: string;
  priority: number;
  conversationId?: string;
  requestId?: string;
}

export interface PatternSummary {
  triggerCondition: string;
  action: { operation: string; targetRef: string };
  confidence: number;
  approvalCount: number;
  rejectionCount: number;
}

export interface SensorCitation {
  metric: string;
  value: unknown;
  zone?: string;
  timestamp: number;
}

/**
 * Build a conversational prompt for operator intents.
 */
export function buildOperatorPrompt(
  intentText: string,
  systemTriggers: TriggerEntry[],
  patterns: PatternSummary[],
): string {
  const systemContext = systemTriggers.length > 0
    ? `\n\nAdditionally, the following system triggers occurred:\n${systemTriggers.map(t => `- ${t.reason}`).join("\n")}`
    : "";

  const patternContext = patterns.length > 0
    ? `\n\n[LEARNED PATTERNS from past operator decisions]\n${patterns.slice(0, 10).map(p =>
        `- "${p.triggerCondition}" → ${p.action.operation} on ${p.action.targetRef} ` +
        `(confidence: ${(p.confidence * 100).toFixed(0)}%, approved ${p.approvalCount}x, rejected ${p.rejectionCount}x)`
      ).join("\n")}`
    : "";

  return `[OPERATOR MESSAGE] "${intentText}"${systemContext}${patternContext}

Respond naturally to the operator's message. Use your tools to check current sensor data if relevant. If the operator is asking for information, provide it clearly with sensor citations. If they're requesting an action that requires actuation, use propose_task. Be conversational but concise. If learned patterns are relevant, mention them.`;
}

/**
 * Build a standard planner cycle prompt from system triggers.
 */
export function buildPlannerPrompt(systemTriggers: TriggerEntry[]): string {
  const triggerSummary = systemTriggers.map((t) => `- ${t.reason}`).join("\n");
  return `[PLANNER CYCLE ${new Date().toISOString()}]
Triggers:
${triggerSummary}

Review the current mesh state using your tools, then either:
1. Take no action if everything is within acceptable parameters
2. Use propose_task to create proposals for actions that need human approval (L2/L3 actuation)
3. For safe read-only operations (L0), execute them directly

Always explain your reasoning. Never fabricate sensor data.`;
}

/**
 * Extract sensor citations from recent frames.
 */
export function extractCitations(
  frames: ContextFrame[],
  maxCount = 5,
): SensorCitation[] {
  return frames
    .filter((f) => f.kind === "observation" && f.data.metric)
    .slice(0, maxCount)
    .map((f) => ({
      metric: String(f.data.metric),
      value: f.data.value,
      zone: f.data.zone as string | undefined,
      timestamp: f.timestamp,
    }));
}

/**
 * Clean an operator intent string by removing the envelope prefix/quotes.
 */
export function cleanIntentText(raw: string): string {
  return raw.replace(/^operator_intent:\s*"?|"?\s*$/g, "");
}

/**
 * Validate a model spec string (e.g. "anthropic/claude-sonnet-4-5-20250929").
 * Returns provider + modelId parts, or throws on invalid format.
 */
export function parseModelSpec(spec: string): { provider: string; modelId: string } {
  const [provider, ...rest] = spec.split("/");
  const modelId = rest.join("/");

  if (!provider || !modelId) {
    throw new Error(
      `Invalid model spec "${spec}". Use "provider/model-id" (e.g. "anthropic/claude-sonnet-4-5-20250929")`,
    );
  }

  return { provider, modelId };
}
