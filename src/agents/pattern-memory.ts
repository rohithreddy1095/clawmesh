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
  /** How many times this pattern was approved. */
  approvalCount: number;
  /** How many times this pattern was rejected. */
  rejectionCount: number;
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

// ─── PatternMemory ──────────────────────────────────────────────────

export class PatternMemory {
  private patterns = new Map<string, LearnedPattern>();
  private readonly persistPath: string;
  private readonly log: { info: (msg: string) => void };

  constructor(opts?: {
    persistPath?: string;
    log?: { info: (msg: string) => void };
  }) {
    this.persistPath =
      opts?.persistPath ??
      join(homedir(), ".clawmesh", "mesh", "patterns.json");
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
        distinctTriggerEvents: [],
        confidence: 0,
        firstSeenAt: Date.now(),
        lastUpdatedAt: Date.now(),
      };
    }

    if (params.approved) {
      pattern.approvalCount++;
    } else {
      pattern.rejectionCount++;
    }

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
   * Import patterns from a remote node. Imported patterns start at lower confidence.
   */
  importPatterns(patterns: LearnedPattern[], sourceDeviceId: string): number {
    let imported = 0;
    for (const remote of patterns) {
      const key = remote.patternId;
      const existing = this.patterns.get(key);
      if (existing) {
        // Merge: take the higher counts but don't let remote override local decisions
        if (remote.lastUpdatedAt > existing.lastUpdatedAt) {
          existing.approvalCount = Math.max(existing.approvalCount, remote.approvalCount);
          existing.rejectionCount = Math.max(existing.rejectionCount, remote.rejectionCount);
          const total = existing.approvalCount + existing.rejectionCount;
          existing.confidence = total > 0 ? existing.approvalCount / total : 0;
          existing.lastUpdatedAt = Date.now();
        }
      } else {
        // New pattern from remote — start at 60% of their confidence
        this.patterns.set(key, {
          ...remote,
          confidence: remote.confidence * 0.6,
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
