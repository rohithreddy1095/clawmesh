import type { ContextFrame, ContextFrameKind } from "./context-types.js";

export type WorldModelEntry = {
  lastFrame: ContextFrame;
  lastUpdated: number;
  updateCount: number;
};

// ─── Relevance Scoring ──────────────────────────────────────

/** Importance weights by frame kind (higher = more important for LLM context). */
const KIND_IMPORTANCE: Record<ContextFrameKind, number> = {
  observation: 3,
  event: 5,
  human_input: 8,
  inference: 2,
  capability_update: 1,
  agent_response: 4,
};

/** Keywords in data that boost importance score. */
const CRITICAL_KEYWORDS = ["critical", "emergency", "failure", "error", "alarm", "breach"];

/**
 * Calculate a relevance score for a context frame.
 * Higher score = more important for LLM reasoning.
 *
 * Factors:
 *   - Kind importance (human_input > event > observation > inference)
 *   - Recency (exponential decay over 1 hour)
 *   - Critical keywords in data
 *   - Trust tier (higher tier = more reliable)
 */
export function scoreFrameRelevance(frame: ContextFrame, now: number = Date.now()): number {
  let score = 0;

  // Kind importance (0-8)
  score += KIND_IMPORTANCE[frame.kind] ?? 1;

  // Recency boost (0-10, decays over 1 hour)
  const ageMs = Math.max(0, now - frame.timestamp);
  const ONE_HOUR = 60 * 60 * 1000;
  const recencyFactor = Math.exp(-ageMs / ONE_HOUR);
  score += recencyFactor * 10;

  // Critical keyword boost (+5 per keyword found)
  const dataStr = JSON.stringify(frame.data).toLowerCase();
  for (const keyword of CRITICAL_KEYWORDS) {
    if (dataStr.includes(keyword)) {
      score += 5;
      break; // One keyword match is enough
    }
  }

  // Trust tier boost (T3 > T2 > T1 > T0)
  const trustTierScores: Record<string, number> = {
    T0_planning_inference: 0,
    T1_unverified_observation: 1,
    T2_operational_observation: 2,
    T3_verified_action_evidence: 3,
  };
  score += trustTierScores[frame.trust.evidence_trust_tier] ?? 0;

  return score;
}

export class WorldModel {
  private entries = new Map<string, WorldModelEntry>();
  private frameLog: ContextFrame[] = [];
  private seenFrameIds = new Set<string>();

  /** Optional callback fired after each successful ingest. Used by PiPlanner. */
  onIngest?: (frame: ContextFrame) => void;

  constructor(
    private opts: {
      maxHistory?: number;
      log: { info: (msg: string) => void };
    },
  ) {}

  /**
   * Ingest a context frame from a remote peer (or local propagator).
   * Returns true if the frame was new, false if it was a duplicate.
   */
  ingest(frame: ContextFrame): boolean {
    // Deduplicate by frameId
    if (this.seenFrameIds.has(frame.frameId)) {
      return false;
    }
    this.seenFrameIds.add(frame.frameId);

    const key = this.makeKey(frame);

    const existing = this.entries.get(key);
    const entry: WorldModelEntry = {
      lastFrame: frame,
      lastUpdated: Date.now(),
      updateCount: (existing?.updateCount ?? 0) + 1,
    };

    this.entries.set(key, entry);
    this.frameLog.push(frame);

    // Trim history
    const maxHistory = this.opts.maxHistory ?? 1000;
    if (this.frameLog.length > maxHistory) {
      this.frameLog = this.frameLog.slice(-maxHistory);
    }
    // Also trim seenFrameIds to avoid unbounded growth
    if (this.seenFrameIds.size > maxHistory * 2) {
      const idsToKeep = new Set(this.frameLog.map((f) => f.frameId));
      this.seenFrameIds = idsToKeep;
    }

    const source =
      frame.sourceDisplayName ?? `${frame.sourceDeviceId.slice(0, 12)}...`;
    this.opts.log.info(`[world-model] Ingested ${frame.kind} from ${source}`);

    // Notify listener (e.g. PiPlanner)
    this.onIngest?.(frame);

    return true;
  }

  /**
   * Query the world model for a specific key.
   */
  get(key: string): WorldModelEntry | undefined {
    return this.entries.get(key);
  }

  /**
   * Get all entries matching a kind.
   */
  getByKind(kind: ContextFrameKind): WorldModelEntry[] {
    return [...this.entries.values()].filter((e) => e.lastFrame.kind === kind);
  }

  /**
   * Get all entries.
   */
  getAll(): WorldModelEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Get all recent frames (most recent last).
   */
  getRecentFrames(limit: number = 100): ContextFrame[] {
    return this.frameLog.slice(-limit);
  }

  /**
   * Number of distinct entries in the world model.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Get recent frames sorted by relevance score (most relevant first).
   * Use this instead of getRecentFrames() when building LLM context windows.
   */
  getRelevantFrames(limit: number = 20, now: number = Date.now()): ContextFrame[] {
    const recent = this.frameLog.slice(-Math.min(this.frameLog.length, limit * 3));
    const scored = recent.map((frame) => ({
      frame,
      score: scoreFrameRelevance(frame, now),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.frame);
  }

  /**
   * Evict entries older than the given TTL.
   * Returns the number of entries evicted.
   */
  evictStale(ttlMs: number): number {
    const cutoff = Date.now() - ttlMs;
    let evicted = 0;

    for (const [key, entry] of this.entries) {
      if (entry.lastFrame.timestamp < cutoff) {
        this.entries.delete(key);
        evicted++;
      }
    }

    // Also clean up the frame log
    if (evicted > 0) {
      const oldLength = this.frameLog.length;
      this.frameLog = this.frameLog.filter((f) => f.timestamp >= cutoff);
      // Rebuild seenFrameIds from remaining frames
      if (this.frameLog.length < oldLength / 2) {
        this.seenFrameIds = new Set(this.frameLog.map((f) => f.frameId));
      }
    }

    return evicted;
  }

  /**
   * Summarize the current world model state as a compact text string
   * suitable for injecting into an LLM context window.
   *
   * Groups observations by zone and shows latest values.
   * Highlights critical conditions.
   */
  summarize(maxFrames: number = 30): string {
    const lines: string[] = [];
    const now = Date.now();

    // Get current state entries grouped by zone
    const byZone = new Map<string, WorldModelEntry[]>();
    const noZone: WorldModelEntry[] = [];

    for (const entry of this.entries.values()) {
      const zone = entry.lastFrame.data.zone;
      if (typeof zone === "string") {
        const list = byZone.get(zone) ?? [];
        list.push(entry);
        byZone.set(zone, list);
      } else {
        noZone.push(entry);
      }
    }

    // Summary header
    lines.push(`World Model: ${this.entries.size} entries, ${this.frameLog.length} frames`);

    // Per-zone summaries
    for (const [zone, entries] of byZone) {
      const observations = entries.filter((e) => e.lastFrame.kind === "observation");
      if (observations.length === 0) continue;

      const metricsStr = observations
        .map((e) => {
          const d = e.lastFrame.data;
          const age = Math.round((now - e.lastFrame.timestamp) / 60_000);
          return `${d.metric}=${d.value}${age > 0 ? ` (${age}m ago)` : ""}`;
        })
        .join(", ");
      lines.push(`  ${zone}: ${metricsStr}`);
    }

    // Recent events and human inputs (most important non-observation frames)
    const importantFrames = this.getRelevantFrames(maxFrames, now)
      .filter((f) => f.kind !== "observation")
      .slice(0, 5);

    if (importantFrames.length > 0) {
      lines.push("  Recent events:");
      for (const f of importantFrames) {
        const age = Math.round((now - f.timestamp) / 60_000);
        const desc = f.note ?? JSON.stringify(f.data).slice(0, 80);
        lines.push(`    [${f.kind}] ${desc} (${age}m ago)`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Composite key for grouping frames: sourceDeviceId + kind + stable data identity.
   * For observations, uses zone+metric if available for a more stable key.
   */
  private makeKey(frame: ContextFrame): string {
    const data = frame.data;
    if (
      frame.kind === "observation" &&
      typeof data.zone === "string" &&
      typeof data.metric === "string"
    ) {
      return `${frame.sourceDeviceId}:${frame.kind}:${data.zone}:${data.metric}`;
    }
    const sortedData = Object.keys(data)
      .sort()
      .reduce(
        (acc, k) => {
          acc[k] = data[k];
          return acc;
        },
        {} as Record<string, unknown>,
      );
    return `${frame.sourceDeviceId}:${frame.kind}:${JSON.stringify(sortedData)}`;
  }
}
