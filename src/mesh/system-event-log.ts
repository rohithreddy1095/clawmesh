/**
 * SystemEventLog — structured audit log for mesh node operations.
 *
 * Captures significant events for post-mortem debugging:
 * - Peer connects/disconnects (with duration)
 * - Proposals created/approved/rejected/expired
 * - Threshold breaches
 * - Mode transitions
 * - Errors
 *
 * Fixed-size ring buffer — old events are dropped when capacity is reached.
 * No disk I/O — pure in-memory for performance.
 */

export type SystemEventType =
  | "peer.connect"
  | "peer.disconnect"
  | "proposal.created"
  | "proposal.resolved"
  | "threshold.breach"
  | "mode.change"
  | "error"
  | "startup"
  | "shutdown";

export interface SystemEvent {
  type: SystemEventType;
  timestamp: number;
  message: string;
  data?: Record<string, unknown>;
}

export class SystemEventLog {
  private events: SystemEvent[] = [];
  private readonly capacity: number;

  constructor(capacity = 500) {
    this.capacity = capacity;
  }

  /**
   * Record a system event.
   */
  record(type: SystemEventType, message: string, data?: Record<string, unknown>): void {
    this.events.push({ type, timestamp: Date.now(), message, data });
    if (this.events.length > this.capacity) {
      this.events = this.events.slice(-this.capacity);
    }
  }

  /**
   * Get recent events, newest first.
   */
  recent(limit = 50): SystemEvent[] {
    return this.events.slice(-limit).reverse();
  }

  /**
   * Get events filtered by type.
   */
  byType(type: SystemEventType, limit = 50): SystemEvent[] {
    return this.events.filter(e => e.type === type).slice(-limit).reverse();
  }

  /**
   * Get events within a time window.
   */
  since(sinceMs: number): SystemEvent[] {
    return this.events.filter(e => e.timestamp >= sinceMs);
  }

  /**
   * Get a summary of events in the last N minutes.
   */
  summary(windowMinutes = 60): {
    total: number;
    byType: Record<string, number>;
    errors: number;
    peerChanges: number;
    proposals: number;
  } {
    const cutoff = Date.now() - windowMinutes * 60_000;
    const recent = this.events.filter(e => e.timestamp >= cutoff);

    const byType: Record<string, number> = {};
    let errors = 0;
    let peerChanges = 0;
    let proposals = 0;

    for (const e of recent) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      if (e.type === "error") errors++;
      if (e.type === "peer.connect" || e.type === "peer.disconnect") peerChanges++;
      if (e.type === "proposal.created" || e.type === "proposal.resolved") proposals++;
    }

    return { total: recent.length, byType, errors, peerChanges, proposals };
  }

  get size(): number {
    return this.events.length;
  }

  clear(): void {
    this.events = [];
  }
}
