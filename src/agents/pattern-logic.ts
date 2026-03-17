/**
 * Pattern logic helpers — pure functions extracted from PatternMemory.
 *
 * Handles confidence calculation, export threshold checking,
 * pattern key generation, and decay computations.
 */

import type { LearnedPattern, SourceCounters } from "./pattern-memory.js";

/**
 * Calculate confidence from approval and rejection counts.
 */
export function calculateConfidence(approvals: number, rejections: number): number {
  const total = approvals + rejections;
  return total > 0 ? approvals / total : 0;
}

/**
 * Check if a pattern meets the gossip/export threshold.
 * Requires 3+ approvals AND 2+ distinct trigger events.
 */
export function meetsExportThreshold(pattern: {
  approvalCount: number;
  distinctTriggerEvents: unknown[];
}): boolean {
  return pattern.approvalCount >= 3 && pattern.distinctTriggerEvents.length >= 2;
}

/**
 * Generate a pattern key from trigger condition, operation, and target.
 */
export function patternKey(
  triggerCondition: string,
  operation: string,
  targetRef: string,
): string {
  return `${triggerCondition}|${operation}|${targetRef}`;
}

/**
 * Calculate time-based confidence decay.
 *
 * @param confidence - Current confidence (0-1)
 * @param lastUpdatedAt - When the pattern was last updated (ms)
 * @param nowMs - Current time (ms)
 * @param decayWindowMs - Window after which decay starts (default: 7 days)
 * @param decayFactor - Factor to multiply confidence by per window (default: 0.9)
 * @param minConfidence - Minimum confidence before removal (default: 0.1)
 * @returns New confidence value
 */
export function decayConfidence(
  confidence: number,
  lastUpdatedAt: number,
  nowMs: number,
  decayWindowMs: number = 7 * 24 * 60 * 60 * 1000,
  decayFactor: number = 0.9,
  minConfidence: number = 0.1,
): number {
  const elapsed = nowMs - lastUpdatedAt;
  if (elapsed < decayWindowMs) return confidence;

  const periods = Math.floor(elapsed / decayWindowMs);
  let decayed = confidence * Math.pow(decayFactor, periods);
  return Math.max(decayed, 0);
}

/**
 * Check if a pattern should be removed after decay.
 */
export function shouldRemovePattern(
  confidence: number,
  minConfidence: number = 0.1,
): boolean {
  return confidence < minConfidence;
}

/**
 * Match a pattern against query criteria.
 */
export function matchesQuery(
  pattern: { metric?: string; zone?: string; triggerCondition: string },
  query: { metric?: string; zone?: string; triggerCondition?: string },
): boolean {
  if (query.metric && pattern.metric && pattern.metric !== query.metric) return false;
  if (query.zone && pattern.zone && pattern.zone !== query.zone) return false;
  if (query.triggerCondition && !pattern.triggerCondition.includes(query.triggerCondition)) return false;
  return true;
}
