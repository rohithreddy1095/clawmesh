/**
 * FrameIngestor — processes incoming context frames for the intelligence layer.
 *
 * Extracted from PiSession.handleIncomingFrame() for testability.
 * Handles:
 * - Pattern import from remote peers
 * - Threshold checking against rules
 * - Trigger generation for breached thresholds
 */

import type { ContextFrame } from "../mesh/context-types.js";
import type { ThresholdRule } from "./types.js";
import { checkThresholdBreach } from "./threshold-checker.js";

export interface FrameIngestResult {
  action: "pattern_import" | "threshold_check" | "skip";
  patternCount?: number;
  breaches: ThresholdBreach[];
}

export interface ThresholdBreach {
  ruleId: string;
  promptHint: string;
  metric: string;
  zone?: string;
  value: number;
}

/**
 * Process an incoming context frame and detect patterns and breaches.
 *
 * @param frame - The incoming context frame
 * @param rules - Active threshold rules
 * @param lastFiredMap - Map of ruleId → last fire time (ms)
 * @param nowMs - Current time (for cooldown checking)
 * @returns Result indicating action taken and any breaches detected
 */
export function ingestFrame(
  frame: ContextFrame,
  rules: ThresholdRule[],
  lastFiredMap: Map<string, number>,
  nowMs: number = Date.now(),
): FrameIngestResult {
  // Check for pattern import
  if (frame.kind === "capability_update" && frame.data.type === "learned_patterns") {
    const patterns = frame.data.patterns;
    const count = Array.isArray(patterns) ? patterns.length : 0;
    return {
      action: "pattern_import",
      patternCount: count,
      breaches: [],
    };
  }

  // Check thresholds
  const breaches: ThresholdBreach[] = [];
  for (const rule of rules) {
    const lastFired = lastFiredMap.get(rule.ruleId) ?? 0;
    if (checkThresholdBreach(rule, frame, lastFired, nowMs)) {
      breaches.push({
        ruleId: rule.ruleId,
        promptHint: rule.promptHint,
        metric: rule.metric,
        zone: rule.zone,
        value: frame.data.value as number,
      });
      // Update the last fired time
      lastFiredMap.set(rule.ruleId, nowMs);
    }
  }

  return {
    action: breaches.length > 0 ? "threshold_check" : "skip",
    breaches,
  };
}

/**
 * Check if a frame contains learnable patterns from a remote peer.
 */
export function isPatternFrame(frame: ContextFrame): boolean {
  return (
    frame.kind === "capability_update" &&
    frame.data.type === "learned_patterns" &&
    Array.isArray(frame.data.patterns)
  );
}

/**
 * Extract patterns from a pattern frame.
 * Returns an empty array if the frame is not a valid pattern frame.
 */
export function extractPatterns(frame: ContextFrame): unknown[] {
  if (!isPatternFrame(frame)) return [];
  return frame.data.patterns as unknown[];
}
