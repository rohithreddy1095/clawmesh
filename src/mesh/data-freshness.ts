/**
 * DataFreshness — annotates world model entries with freshness status.
 *
 * Production problem: a sensor node goes offline, but the world model still
 * has its last reading. The planner sees "moisture = 12%" and proposes
 * irrigation, not knowing the reading is 2 hours old and conditions may
 * have changed.
 *
 * This module provides:
 * - Freshness classification (fresh / aging / stale / expired)
 * - Per-metric expected update intervals
 * - Annotations for planner system prompt injection
 */

export type FreshnessLevel = "fresh" | "aging" | "stale" | "expired";

export interface FreshnessConfig {
  /** Expected update interval for this metric (ms). Default: 30s. */
  expectedIntervalMs?: number;
  /** After how many missed intervals is data "aging"? Default: 3. */
  agingThreshold?: number;
  /** After how many missed intervals is data "stale"? Default: 10. */
  staleThreshold?: number;
  /** After how many missed intervals is data "expired"? Default: 60. */
  expiredThreshold?: number;
}

const DEFAULT_INTERVAL = 30_000; // 30 seconds
const DEFAULT_AGING = 3;
const DEFAULT_STALE = 10;
const DEFAULT_EXPIRED = 60;

/**
 * Classify data freshness based on elapsed time since last update.
 */
export function classifyFreshness(
  lastUpdateMs: number,
  now: number = Date.now(),
  config: FreshnessConfig = {},
): FreshnessLevel {
  const interval = config.expectedIntervalMs ?? DEFAULT_INTERVAL;
  const elapsed = now - lastUpdateMs;
  const missedIntervals = elapsed / interval;

  if (missedIntervals <= (config.agingThreshold ?? DEFAULT_AGING)) return "fresh";
  if (missedIntervals <= (config.staleThreshold ?? DEFAULT_STALE)) return "aging";
  if (missedIntervals <= (config.expiredThreshold ?? DEFAULT_EXPIRED)) return "stale";
  return "expired";
}

/**
 * Build a freshness annotation for a world model entry.
 * Used to inject context into the planner's system prompt.
 */
export function formatFreshnessWarning(
  metric: string,
  zone: string | undefined,
  level: FreshnessLevel,
  elapsedMs: number,
): string | null {
  if (level === "fresh") return null;

  const location = zone ? `${zone}:${metric}` : metric;
  const elapsed = formatElapsed(elapsedMs);

  switch (level) {
    case "aging":
      return `⚠ ${location} data is ${elapsed} old — may need re-check`;
    case "stale":
      return `⚠⚠ ${location} data is ${elapsed} old — STALE, do not trust without re-read`;
    case "expired":
      return `🚫 ${location} data is ${elapsed} old — EXPIRED, sensor may be offline`;
  }
}

/**
 * Classify freshness for multiple world model entries and return warnings.
 */
export function getDataFreshnessWarnings(
  entries: Array<{
    metric: string;
    zone?: string;
    lastUpdated: number;
    expectedIntervalMs?: number;
  }>,
  now = Date.now(),
): string[] {
  const warnings: string[] = [];
  for (const entry of entries) {
    const level = classifyFreshness(entry.lastUpdated, now, {
      expectedIntervalMs: entry.expectedIntervalMs,
    });
    const warning = formatFreshnessWarning(
      entry.metric,
      entry.zone,
      level,
      now - entry.lastUpdated,
    );
    if (warning) warnings.push(warning);
  }
  return warnings;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}m`;
}
