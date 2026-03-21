/**
 * MetricsCollector — lightweight operational metrics for mesh nodes.
 *
 * Tracks counters and gauges for production monitoring:
 * - Request/response counts
 * - Error rates
 * - Connection counts
 * - Frame processing rates
 *
 * No external dependencies — just in-memory counters with time windows.
 */

export type MetricType = "counter" | "gauge";

export interface MetricSnapshot {
  name: string;
  type: MetricType;
  value: number;
  labels?: Record<string, string>;
}

export class MetricsCollector {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();

  /**
   * Increment a counter by delta (default 1).
   */
  inc(name: string, delta = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + delta);
  }

  /**
   * Set a gauge to an absolute value.
   */
  set(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  /**
   * Get a counter value.
   */
  getCounter(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  /**
   * Get a gauge value.
   */
  getGauge(name: string): number {
    return this.gauges.get(name) ?? 0;
  }

  /**
   * Get all metrics as a snapshot.
   */
  snapshot(): MetricSnapshot[] {
    const result: MetricSnapshot[] = [];
    for (const [name, value] of this.counters) {
      result.push({ name, type: "counter", value });
    }
    for (const [name, value] of this.gauges) {
      result.push({ name, type: "gauge", value });
    }
    return result;
  }

  /**
   * Reset all counters (useful for windowed metrics).
   */
  resetCounters(): void {
    this.counters.clear();
  }

  /**
   * Reset everything.
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
  }

  /**
   * Get total number of tracked metrics.
   */
  get size(): number {
    return this.counters.size + this.gauges.size;
  }
}

/**
 * Standard mesh node metric names.
 */
export const MESH_METRICS = {
  /** Total inbound messages received. */
  INBOUND_MESSAGES: "mesh.inbound.messages",
  /** Total inbound messages rate-limited. */
  INBOUND_RATE_LIMITED: "mesh.inbound.rate_limited",
  /** Total inbound messages rejected (size/format). */
  INBOUND_REJECTED: "mesh.inbound.rejected",
  /** Total outbound messages sent. */
  OUTBOUND_MESSAGES: "mesh.outbound.messages",
  /** Total RPC requests dispatched. */
  RPC_REQUESTS: "mesh.rpc.requests",
  /** Total RPC errors. */
  RPC_ERRORS: "mesh.rpc.errors",
  /** Total context frames ingested. */
  FRAMES_INGESTED: "mesh.frames.ingested",
  /** Total context frames broadcast. */
  FRAMES_BROADCAST: "mesh.frames.broadcast",
  /** Current connected peer count (gauge). */
  PEERS_CONNECTED: "mesh.peers.connected",
  /** Current world model entry count (gauge). */
  WORLD_MODEL_ENTRIES: "mesh.world_model.entries",
  /** LLM calls attempted. */
  LLM_CALLS: "mesh.llm.calls",
  /** LLM call errors. */
  LLM_ERRORS: "mesh.llm.errors",
} as const;
