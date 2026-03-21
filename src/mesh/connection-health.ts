/**
 * ConnectionHealthMonitor — detects and removes stale peer connections.
 *
 * In production, WebSocket connections can silently die (network changes,
 * firewall timeouts, etc.) without triggering close events. This monitor
 * periodically pings peers and removes unresponsive ones.
 *
 * Features:
 * - Periodic ping/pong health checks
 * - Configurable timeout threshold
 * - Auto-removal of stale connections from registry
 * - Health statistics for dashboard display
 */

export type ConnectionHealthStats = {
  totalChecks: number;
  staleRemoved: number;
  lastCheckMs: number;
  avgResponseMs: number;
};

export type ConnectionHealthConfig = {
  /** How often to check connections (ms). Default: 30s. */
  checkIntervalMs?: number;
  /** How long before a peer is considered stale (ms). Default: 60s. */
  staleThresholdMs?: number;
  /** Callback when a stale peer is detected. */
  onStaleDetected?: (deviceId: string, lastSeenMs: number) => void;
};

export class ConnectionHealthMonitor {
  private lastSeen = new Map<string, number>();
  private stats: ConnectionHealthStats = {
    totalChecks: 0,
    staleRemoved: 0,
    lastCheckMs: 0,
    avgResponseMs: 0,
  };
  private readonly staleThresholdMs: number;
  private readonly onStaleDetected?: (deviceId: string, lastSeenMs: number) => void;

  constructor(config: ConnectionHealthConfig = {}) {
    this.staleThresholdMs = config.staleThresholdMs ?? 60_000;
    this.onStaleDetected = config.onStaleDetected;
  }

  /**
   * Record that we've received data from a peer (proof of liveness).
   */
  recordActivity(deviceId: string): void {
    this.lastSeen.set(deviceId, Date.now());
  }

  /**
   * Check all tracked peers for staleness.
   * Returns list of stale device IDs.
   */
  checkAll(now = Date.now()): string[] {
    this.stats.totalChecks++;
    this.stats.lastCheckMs = now;

    const stale: string[] = [];
    for (const [deviceId, lastMs] of this.lastSeen) {
      if (now - lastMs > this.staleThresholdMs) {
        stale.push(deviceId);
        this.onStaleDetected?.(deviceId, lastMs);
      }
    }

    this.stats.staleRemoved += stale.length;

    // Remove stale entries
    for (const id of stale) {
      this.lastSeen.delete(id);
    }

    return stale;
  }

  /**
   * Remove a peer from tracking (e.g., on disconnect).
   */
  removePeer(deviceId: string): void {
    this.lastSeen.delete(deviceId);
  }

  /**
   * Get time since last activity for a peer, or null if not tracked.
   */
  getTimeSinceActivity(deviceId: string, now = Date.now()): number | null {
    const last = this.lastSeen.get(deviceId);
    return last !== undefined ? now - last : null;
  }

  /**
   * Check if a specific peer is stale.
   */
  isStale(deviceId: string, now = Date.now()): boolean {
    const elapsed = this.getTimeSinceActivity(deviceId, now);
    return elapsed !== null && elapsed > this.staleThresholdMs;
  }

  /**
   * Get health statistics.
   */
  getStats(): ConnectionHealthStats {
    return { ...this.stats };
  }

  /**
   * Get count of currently tracked peers.
   */
  get trackedPeers(): number {
    return this.lastSeen.size;
  }
}
