/**
 * PatternMemory — learns from operator approve/reject decisions and propagates
 * patterns across the mesh via gossip.
 *
 * Each pattern tracks a trigger condition + action + confidence score built from
 * repeated decisions. When confidence crosses a threshold, patterns can be
 * exported for gossip to other nodes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// ─── Types ──────────────────────────────────────────────────────────

/**
 * Per-source counters for CRDT merge.
 * Each device tracks its own approval/rejection counts.
 * On merge, sum across all sources for correct distributed totals.
 */
export type SourceCounters = Record<string, { approvals: number; rejections: number }>;

export type LearnedPattern = {
  /** Unique pattern ID. */
  patternId: string;
  /** Trigger condition description (e.g. "soil_moisture < 25 in zone-1"). */
  triggerCondition: string;
  /** Metric that triggers this pattern. */
  metric?: string;
  /** Zone this pattern applies to. */
  zone?: string;
  /** Threshold that was breached. */
  threshold?: { above?: number; below?: number };
  /** The action that was proposed. */
  action: {
    operation: string;
    targetRef: string;
    operationParams?: Record<string, unknown>;
    summary: string;
  };
  /** How many times this pattern was approved (aggregate across all sources). */
  approvalCount: number;
  /** How many times this pattern was rejected (aggregate across all sources). */
  rejectionCount: number;
  /** Per-source counters for CRDT merge (grow-only counters per device). */
  sourceCounters?: SourceCounters;
  /** Distinct trigger event IDs that led to this pattern firing. */
  distinctTriggerEvents: string[];
  /** Confidence score: approvals / (approvals + rejections). */
  confidence: number;
  /** When this pattern was first seen. */
  firstSeenAt: number;
  /** When this pattern was last updated. */
  lastUpdatedAt: number;
  /** Source device ID (which node learned this). */
  sourceDeviceId?: string;
};

type PatternStore = {
  version: 1;
  patterns: LearnedPattern[];
};

// ─── CRDT Helpers ───────────────────────────────────────────────────

/**
 * Merge two source counter maps using per-source max (grow-only counter CRDT).
 */
export function mergeSourceCounters(local: SourceCounters, remote: SourceCounters): SourceCounters {
  const merged: SourceCounters = { ...local };
  for (const [source, remoteCounts] of Object.entries(remote)) {
    const localCounts = merged[source];
    if (localCounts) {
      merged[source] = {
        approvals: Math.max(localCounts.approvals, remoteCounts.approvals),
        rejections: Math.max(localCounts.rejections, remoteCounts.rejections),
      };
    } else {
      merged[source] = { ...remoteCounts };
    }
  }
  return merged;
}

/**
 * Sum all per-source counters into aggregate totals.
 */
export function aggregateSourceCounters(counters: SourceCounters): {
  approvals: number;
  rejections: number;
} {
  let approvals = 0;
  let rejections = 0;
  for (const counts of Object.values(counters)) {
    approvals += counts.approvals;
    rejections += counts.rejections;
  }
  return { approvals, rejections };
}

// ─── PatternMemory ──────────────────────────────────────────────────

export class PatternMemory {
  private patterns = new Map<string, LearnedPattern>();
  private readonly persistPath: string;
  private readonly log: { info: (msg: string) => void };
  private readonly localDeviceId: string;

  constructor(opts?: {
    persistPath?: string;
    localDeviceId?: string;
    log?: { info: (msg: string) => void };
  }) {
    this.persistPath =
      opts?.persistPath ??
      join(homedir(), ".clawmesh", "mesh", "patterns.json");
    this.localDeviceId = opts?.localDeviceId ?? "local";
    this.log = opts?.log ?? { info: console.log };
    this.load();
  }

  /**
   * Record a decision (approve/reject) for a proposal. Builds or updates patterns.
   */
  recordDecision(params: {
    approved: boolean;
    triggerCondition: string;
    metric?: string;
    zone?: string;
    threshold?: { above?: number; below?: number };
    action: {
      operation: string;
      targetRef: string;
      operationParams?: Record<string, unknown>;
      summary: string;
    };
    triggerEventId?: string;
  }): LearnedPattern {
    const key = this.patternKey(params.triggerCondition, params.action.operation, params.action.targetRef);
    let pattern = this.patterns.get(key);

    if (!pattern) {
      pattern = {
        patternId: key,
        triggerCondition: params.triggerCondition,
        metric: params.metric,
        zone: params.zone,
        threshold: params.threshold,
        action: params.action,
        approvalCount: 0,
        rejectionCount: 0,
        sourceCounters: {},
        distinctTriggerEvents: [],
        confidence: 0,
        firstSeenAt: Date.now(),
        lastUpdatedAt: Date.now(),
      };
    }

    // Update per-source CRDT counters
    const localId = this.localDeviceId;
    if (!pattern.sourceCounters) pattern.sourceCounters = {};
    if (!pattern.sourceCounters[localId]) {
      pattern.sourceCounters[localId] = { approvals: 0, rejections: 0 };
    }
    if (params.approved) {
      pattern.sourceCounters[localId].approvals++;
    } else {
      pattern.sourceCounters[localId].rejections++;
    }

    // Recompute aggregates from all source counters
    const { approvals, rejections } = aggregateSourceCounters(pattern.sourceCounters);
    pattern.approvalCount = approvals;
    pattern.rejectionCount = rejections;

    if (params.triggerEventId && !pattern.distinctTriggerEvents.includes(params.triggerEventId)) {
      pattern.distinctTriggerEvents.push(params.triggerEventId);
      // Keep last 20 event IDs
      if (pattern.distinctTriggerEvents.length > 20) {
        pattern.distinctTriggerEvents = pattern.distinctTriggerEvents.slice(-20);
      }
    }

    const total = pattern.approvalCount + pattern.rejectionCount;
    pattern.confidence = total > 0 ? pattern.approvalCount / total : 0;
    pattern.lastUpdatedAt = Date.now();

    this.patterns.set(key, pattern);
    this.save();

    this.log.info(
      `[pattern-memory] Recorded ${params.approved ? "approval" : "rejection"} for "${params.triggerCondition}" → ` +
      `${params.action.operation} (confidence: ${(pattern.confidence * 100).toFixed(0)}%, ` +
      `approvals: ${pattern.approvalCount}, rejections: ${pattern.rejectionCount})`
    );

    return pattern;
  }

  /**
   * Find patterns matching a given trigger condition and/or metric.
   */
  getMatchingPatterns(params: {
    metric?: string;
    zone?: string;
    triggerCondition?: string;
  }): LearnedPattern[] {
    const results: LearnedPattern[] = [];
    for (const pattern of this.patterns.values()) {
      if (params.metric && pattern.metric && pattern.metric !== params.metric) continue;
      if (params.zone && pattern.zone && pattern.zone !== params.zone) continue;
      if (
        params.triggerCondition &&
        !pattern.triggerCondition.includes(params.triggerCondition)
      ) continue;
      results.push(pattern);
    }
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Export patterns that have crossed the gossip threshold.
   * Threshold: 3+ approvals AND 2+ distinct trigger events.
   */
  exportPatterns(): LearnedPattern[] {
    return [...this.patterns.values()].filter(
      (p) => p.approvalCount >= 3 && p.distinctTriggerEvents.length >= 2
    );
  }

  /**
   * Import patterns from a remote node using CRDT merge.
   *
   * Merge strategy (grow-only counters per source):
   *   - For each source in remote.sourceCounters, take max(local, remote)
   *   - Recompute aggregates from merged source counters
   *   - This correctly handles concurrent decisions across nodes
   */
  importPatterns(patterns: LearnedPattern[], sourceDeviceId: string): number {
    let imported = 0;
    for (const remote of patterns) {
      const key = remote.patternId;
      const existing = this.patterns.get(key);
      if (existing) {
        // CRDT merge: merge per-source counters using max()
        const mergedCounters = mergeSourceCounters(
          existing.sourceCounters ?? {},
          remote.sourceCounters ?? {},
        );
        existing.sourceCounters = mergedCounters;

        // Recompute aggregates from merged counters
        const { approvals, rejections } = aggregateSourceCounters(mergedCounters);
        existing.approvalCount = approvals;
        existing.rejectionCount = rejections;
        const total = approvals + rejections;
        existing.confidence = total > 0 ? approvals / total : 0;
        existing.lastUpdatedAt = Date.now();

        // Merge distinct trigger events
        for (const eventId of remote.distinctTriggerEvents) {
          if (!existing.distinctTriggerEvents.includes(eventId)) {
            existing.distinctTriggerEvents.push(eventId);
          }
        }
        if (existing.distinctTriggerEvents.length > 20) {
          existing.distinctTriggerEvents = existing.distinctTriggerEvents.slice(-20);
        }
      } else {
        // New pattern from remote — import with source counters
        this.patterns.set(key, {
          ...remote,
          sourceCounters: remote.sourceCounters ?? {},
          sourceDeviceId,
          lastUpdatedAt: Date.now(),
        });
        imported++;
      }
    }
    if (imported > 0) {
      this.save();
      this.log.info(`[pattern-memory] Imported ${imported} patterns from ${sourceDeviceId.slice(0, 12)}`);
    }
    return imported;
  }

  /**
   * Get all patterns.
   */
  getAllPatterns(): LearnedPattern[] {
    return [...this.patterns.values()];
  }

  /**
   * Apply time-based confidence decay to patterns that haven't been
   * reinforced recently. This prevents stale patterns from accumulating
   * indefinitely and keeps the learning model fresh.
   *
   * Decay formula: confidence *= decayFactor for each pattern not updated
   * within the specified inactivity window. Patterns below the minimum
   * confidence threshold are removed entirely.
   *
   * @param inactiveMs - How long since lastUpdatedAt before decay applies (default: 7 days)
   * @param decayFactor - Multiplier applied to confidence (default: 0.8 = 20% reduction)
   * @param minConfidence - Patterns below this are removed (default: 0.1)
   * @returns Number of patterns decayed + number removed
   */
  decayPatterns(opts?: {
    inactiveMs?: number;
    decayFactor?: number;
    minConfidence?: number;
  }): { decayed: number; removed: number } {
    const inactiveMs = opts?.inactiveMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days
    const decayFactor = opts?.decayFactor ?? 0.8;
    const minConfidence = opts?.minConfidence ?? 0.1;
    const cutoff = Date.now() - inactiveMs;

    let decayed = 0;
    let removed = 0;
    const toRemove: string[] = [];

    for (const [key, pattern] of this.patterns) {
      if (pattern.lastUpdatedAt < cutoff) {
        pattern.confidence *= decayFactor;
        decayed++;

        if (pattern.confidence < minConfidence) {
          toRemove.push(key);
        }
      }
    }

    for (const key of toRemove) {
      this.patterns.delete(key);
      removed++;
    }

    if (decayed > 0) {
      this.save();
      this.log.info(
        `[pattern-memory] Decayed ${decayed} patterns (${removed} removed below threshold)`,
      );
    }

    return { decayed, removed };
  }

  // ─── Persistence ──────────────────────────────────────

  private load(): void {
    try {
      if (existsSync(this.persistPath)) {
        const raw = readFileSync(this.persistPath, "utf-8");
        const store: PatternStore = JSON.parse(raw);
        if (store.version === 1 && Array.isArray(store.patterns)) {
          for (const p of store.patterns) {
            this.patterns.set(p.patternId, p);
          }
          this.log.info(`[pattern-memory] Loaded ${this.patterns.size} patterns from disk`);
        }
      }
    } catch (err) {
      // Ignore load errors — start fresh
    }
  }

  private save(): void {
    try {
      const dir = dirname(this.persistPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const store: PatternStore = {
        version: 1,
        patterns: [...this.patterns.values()],
      };
      writeFileSync(this.persistPath, JSON.stringify(store, null, 2));
    } catch (err) {
      // Silently fail on save errors
    }
  }

  private patternKey(triggerCondition: string, operation: string, targetRef: string): string {
    // Normalize to create a stable key
    const normalized = `${triggerCondition}|${operation}|${targetRef}`
      .toLowerCase()
      .replace(/\s+/g, "_");
    return normalized;
  }
}
