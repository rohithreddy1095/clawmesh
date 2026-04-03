/**
 * ProposalDedup — detects and prevents duplicate proposals across the mesh.
 *
 * When multiple planner nodes observe the same conditions, they may both
 * propose the same action (e.g., two nodes both see dry soil → both propose
 * irrigation). This module detects near-duplicate proposals by matching
 * on (targetRef, operation, zone) within a time window.
 *
 * This is critical for production safety — you don't want two irrigation
 * cycles triggered for the same zone because two planners independently
 * detected the same condition.
 */

export interface ProposalSignature {
  targetRef: string;
  operation: string;
  zone?: string;
  plannerDeviceId?: string;
}

export interface ProposalDedupRecord {
  actionKey: string;
  plannerKey: string;
  plannerDeviceId?: string;
  seenAt: number;
}

export interface DedupConfig {
  /** Time window for dedup (ms). Default: 10 minutes. */
  windowMs?: number;
}

export class ProposalDedup {
  private seen = new Map<string, ProposalDedupRecord>(); // action key → record
  private readonly windowMs: number;

  constructor(config: DedupConfig = {}) {
    this.windowMs = config.windowMs ?? 10 * 60_000;
  }

  /**
   * Check if this proposal is a duplicate of a recent one.
   * Returns true if it's new (should proceed), false if it's a duplicate.
   */
  checkAndRecord(sig: ProposalSignature, now = Date.now()): boolean {
    this.cleanup(now);
    const actionKey = this.makeKey(sig);
    const lastSeen = this.seen.get(actionKey);
    if (lastSeen !== undefined && now - lastSeen.seenAt < this.windowMs) {
      return false; // Duplicate — too recent
    }
    this.seen.set(actionKey, {
      actionKey,
      plannerKey: this.makePlannerKey(sig),
      plannerDeviceId: sig.plannerDeviceId,
      seenAt: now,
    });
    return true; // New — proceed
  }

  /**
   * Check without recording (peek).
   */
  isDuplicate(sig: ProposalSignature, now = Date.now()): boolean {
    this.cleanup(now);
    const key = this.makeKey(sig);
    const lastSeen = this.seen.get(key);
    return lastSeen !== undefined && now - lastSeen.seenAt < this.windowMs;
  }

  /**
   * Reset dedup state for a specific action (e.g., after conditions change).
   */
  reset(sig: ProposalSignature): void {
    this.seen.delete(this.makeKey(sig));
  }

  /**
   * Clear all dedup state.
   */
  clear(): void {
    this.seen.clear();
  }

  get size(): number {
    return this.seen.size;
  }

  getRecord(sig: ProposalSignature, now = Date.now()): ProposalDedupRecord | undefined {
    this.cleanup(now);
    return this.seen.get(this.makeKey(sig));
  }

  private makeKey(sig: ProposalSignature): string {
    return `${sig.targetRef}|${sig.operation}|${sig.zone ?? "*"}`;
  }

  private makePlannerKey(sig: ProposalSignature): string {
    return `${sig.plannerDeviceId ?? "unknown"}|${this.makeKey(sig)}`;
  }

  private cleanup(now: number): void {
    for (const [key, record] of this.seen) {
      if (now - record.seenAt >= this.windowMs) {
        this.seen.delete(key);
      }
    }
  }
}
