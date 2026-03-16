/**
 * ThresholdChecker — pure functions for evaluating threshold rules against
 * context frames.
 *
 * Extracted from PiSession to enable direct testing of threshold logic
 * without needing the full PiSession + LLM SDK.
 */

import type { ContextFrame } from "../mesh/context-types.js";
import type { ThresholdRule } from "./types.js";

/**
 * Check if a context frame breaches a threshold rule.
 *
 * Returns true if:
 *   1. Frame is an observation
 *   2. Metric matches the rule
 *   3. Zone matches (if rule specifies a zone)
 *   4. Value crosses the threshold (below or above)
 *   5. Cooldown has elapsed since last fire
 *
 * @param rule - The threshold rule to check
 * @param frame - The context frame to evaluate
 * @param lastFiredMs - When this rule last fired (0 = never)
 * @param nowMs - Current time (for cooldown calculation)
 * @returns Whether the threshold is breached
 */
export function checkThresholdBreach(
  rule: ThresholdRule,
  frame: ContextFrame,
  lastFiredMs: number = 0,
  nowMs: number = Date.now(),
): boolean {
  if (frame.kind !== "observation") return false;

  const data = frame.data;
  if (typeof data.metric !== "string" || data.metric !== rule.metric) return false;
  if (rule.zone && data.zone !== rule.zone) return false;

  const value = typeof data.value === "number" ? data.value : null;
  if (value === null) return false;

  let breached = false;
  if (rule.belowThreshold !== undefined && value < rule.belowThreshold) breached = true;
  if (rule.aboveThreshold !== undefined && value > rule.aboveThreshold) breached = true;
  if (!breached) return false;

  const cooldownMs = rule.cooldownMs ?? 300_000;
  if (nowMs - lastFiredMs < cooldownMs) return false;

  return true;
}

/**
 * Check if an LLM error is permanent (should suspend the session).
 * Permanent errors: 403, 401, forbidden, disabled, terms of service, account issues.
 */
export function isPermanentLLMError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes("403") ||
    msg.includes("forbidden") ||
    msg.includes("disabled") ||
    msg.includes("terms of service") ||
    msg.includes("account") ||
    msg.includes("unauthorized") ||
    msg.includes("401")
  );
}
