/**
 * TriggerQueue — priority queue for planner triggers with deduplication.
 *
 * Replaces the plain pendingTriggers[] array in PiSession.
 * Provides:
 *   - Priority ordering: operator intents > critical thresholds > normal > proactive
 *   - Deduplication: same metric+zone within a time window → single trigger
 *   - Drain semantics: take all pending triggers as a batch
 */

import type { ContextFrame } from "../mesh/context-types.js";

// ─── Types ──────────────────────────────────────────────────

export type TriggerType =
  | "operator_intent"
  | "threshold_breach"
  | "proactive_check";

export type TriggerPriority = 0 | 1 | 2 | 3;

/** Priority values — lower number = higher priority. */
export const TRIGGER_PRIORITIES: Record<TriggerType, TriggerPriority> = {
  operator_intent: 0,    // Highest: human is waiting
  threshold_breach: 1,   // High: automated alert
  proactive_check: 3,    // Lowest: routine scan
};

export type TriggerEntry = {
  reason: string;
  frames: ContextFrame[];
  conversationId?: string;
  requestId?: string;
  type: TriggerType;
  priority: TriggerPriority;
  /** When this trigger was enqueued (for dedup windows). */
  enqueuedAt: number;
  /** Dedup key (for threshold_breach: metric:zone). */
  dedupKey?: string;
};

export type TriggerQueueStats = {
  total: number;
  operatorIntent: number;
  thresholdBreach: number;
  proactiveCheck: number;
};

// ─── Queue ──────────────────────────────────────────────────

export class TriggerQueue {
  private queue: TriggerEntry[] = [];
  private readonly dedupWindowMs: number;
  private readonly maxSize: number;

  constructor(opts?: { dedupWindowMs?: number; maxSize?: number }) {
    this.dedupWindowMs = opts?.dedupWindowMs ?? 30_000; // 30 seconds
    this.maxSize = opts?.maxSize ?? 50;
  }

  /**
   * Enqueue a trigger. Returns true if added, false if deduplicated.
   */
  enqueue(trigger: Omit<TriggerEntry, "priority" | "enqueuedAt">): boolean {
    const now = Date.now();
    const priority = TRIGGER_PRIORITIES[trigger.type];

    // Deduplication: check for same dedupKey within the window
    if (trigger.dedupKey) {
      const existing = this.queue.find(
        (t) =>
          t.dedupKey === trigger.dedupKey &&
          now - t.enqueuedAt < this.dedupWindowMs,
      );
      if (existing) {
        // Update frames on existing trigger (merge new data)
        if (trigger.frames.length > 0) {
          existing.frames = trigger.frames;
        }
        return false; // Deduplicated
      }
    }

    // Enforce max size: drop lowest priority AMONG existing + new entry
    if (this.queue.length >= this.maxSize) {
      // If the new entry has lower priority than the worst existing, don't add it
      this.queue.sort((a, b) => a.priority - b.priority);
      const worstExisting = this.queue[this.queue.length - 1];
      if (priority >= worstExisting.priority) {
        return false; // New trigger is lower or equal priority — discard it
      }
      this.queue.pop(); // Remove existing lowest priority to make room
    }

    const entry: TriggerEntry = {
      ...trigger,
      priority,
      enqueuedAt: now,
    };
    this.queue.push(entry);

    return true;
  }

  /**
   * Convenience: enqueue an operator intent.
   */
  enqueueIntent(text: string, opts?: { conversationId?: string; requestId?: string }): boolean {
    return this.enqueue({
      reason: `operator_intent: "${text}"`,
      frames: [],
      conversationId: opts?.conversationId,
      requestId: opts?.requestId,
      type: "operator_intent",
    });
  }

  /**
   * Convenience: enqueue a threshold breach.
   */
  enqueueThresholdBreach(params: {
    ruleId: string;
    promptHint: string;
    metric: string;
    zone?: string;
    frame: ContextFrame;
  }): boolean {
    return this.enqueue({
      reason: `threshold_breach: ${params.ruleId} — ${params.promptHint}`,
      frames: [params.frame],
      type: "threshold_breach",
      dedupKey: `threshold:${params.metric}:${params.zone ?? "global"}`,
    });
  }

  /**
   * Convenience: enqueue a proactive check.
   */
  enqueueProactiveCheck(frames: ContextFrame[]): boolean {
    return this.enqueue({
      reason: "proactive_check: periodic farm state review",
      frames,
      type: "proactive_check",
      dedupKey: "proactive",
    });
  }

  /**
   * Drain all pending triggers, sorted by priority (highest first).
   * Returns triggers grouped into operator intents and system triggers.
   */
  drain(): { operatorIntents: TriggerEntry[]; systemTriggers: TriggerEntry[] } {
    // Sort by priority (lower number = higher priority)
    this.queue.sort((a, b) => a.priority - b.priority);

    const all = this.queue.splice(0);
    return {
      operatorIntents: all.filter((t) => t.type === "operator_intent"),
      systemTriggers: all.filter((t) => t.type !== "operator_intent"),
    };
  }

  /**
   * Drain all triggers as a flat list sorted by priority.
   */
  drainAll(): TriggerEntry[] {
    this.queue.sort((a, b) => a.priority - b.priority);
    return this.queue.splice(0);
  }

  /**
   * Peek at the highest priority trigger without removing it.
   */
  peek(): TriggerEntry | undefined {
    if (this.queue.length === 0) return undefined;
    this.queue.sort((a, b) => a.priority - b.priority);
    return this.queue[0];
  }

  /** Number of pending triggers. */
  get length(): number {
    return this.queue.length;
  }

  /** Whether the queue is empty. */
  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  getStats(): TriggerQueueStats {
    return {
      total: this.queue.length,
      operatorIntent: this.queue.filter((entry) => entry.type === "operator_intent").length,
      thresholdBreach: this.queue.filter((entry) => entry.type === "threshold_breach").length,
      proactiveCheck: this.queue.filter((entry) => entry.type === "proactive_check").length,
    };
  }

  /** Clear all pending triggers. */
  clear(): void {
    this.queue.length = 0;
  }
}
