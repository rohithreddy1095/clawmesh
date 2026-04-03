/**
 * Auto-Connect — bridges mDNS discovery to peer connection.
 *
 * When a peer is discovered via mDNS and is already in the trust store,
 * automatically initiate a connection. This closes the gap between
 * "discovered" and "connected" — true zero-config for trusted LAN peers.
 *
 * Flow:
 *   1. MeshDiscovery emits "peer-discovered"
 *   2. AutoConnect checks if deviceId is in trust store
 *   3. If trusted + not already connected → initiate connection
 */

import type { MeshDiscoveredPeer } from "./discovery.js";
import { isTrustedPeer } from "./peer-trust.js";

// ─── Types ──────────────────────────────────────────────────

export type AutoConnectDecision =
  | { action: "connect"; url: string; reason: string; transportLabel: string }
  | { action: "skip"; reason: string };

export type AutoConnectOptions = {
  /** Maximum number of auto-connect attempts per peer per hour. */
  maxAttemptsPerHour?: number;
};

// ─── AutoConnect Logic ──────────────────────────────────────

/**
 * Tracks auto-connect state: which peers we've attempted to connect to
 * and rate-limiting to prevent connection storms.
 */
export class AutoConnectManager {
  private readonly maxAttemptsPerHour: number;
  private readonly attempts = new Map<string, number[]>(); // deviceId → timestamps
  private readonly connectedPeers = new Set<string>();
  private readonly deadPeers = new Set<string>();

  constructor(opts?: AutoConnectOptions) {
    this.maxAttemptsPerHour = opts?.maxAttemptsPerHour ?? 5;
  }

  /**
   * Mark a peer as currently connected (skip auto-connect for it).
   */
  markConnected(deviceId: string): void {
    this.deadPeers.delete(deviceId);
    this.connectedPeers.add(deviceId);
  }

  /**
   * Mark a peer as disconnected (allow future auto-connect).
   */
  markDisconnected(deviceId: string): void {
    this.connectedPeers.delete(deviceId);
  }

  /**
   * Mark a peer as confirmed dead so stale discovery noise does not immediately reconnect it.
   */
  markDead(deviceId: string): void {
    this.connectedPeers.delete(deviceId);
    this.deadPeers.add(deviceId);
  }

  /**
   * Check whether a peer is currently suppressed because it was confirmed dead.
   */
  isDeadSuppressed(deviceId: string): boolean {
    return this.deadPeers.has(deviceId);
  }

  /**
   * Evaluate whether to auto-connect to a discovered peer.
   * Does NOT check the trust store — use evaluateWithTrust() for the full flow.
   */
  evaluate(peer: MeshDiscoveredPeer): AutoConnectDecision {
    // Already connected
    if (this.connectedPeers.has(peer.deviceId)) {
      return { action: "skip", reason: "already connected" };
    }

    // Suppressed because the peer was recently confirmed dead.
    if (this.deadPeers.has(peer.deviceId)) {
      return { action: "skip", reason: "peer marked dead" };
    }

    // Rate limiting
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const history = this.attempts.get(peer.deviceId) ?? [];
    const recentAttempts = history.filter((t) => t > oneHourAgo);

    if (recentAttempts.length >= this.maxAttemptsPerHour) {
      return {
        action: "skip",
        reason: `rate limited: ${recentAttempts.length} attempts in last hour`,
      };
    }

    // Missing host/port
    if (!peer.host || !peer.port) {
      return { action: "skip", reason: "missing host or port in discovery" };
    }

    // Record attempt
    recentAttempts.push(now);
    this.attempts.set(peer.deviceId, recentAttempts);

    const url = `ws://${peer.host}:${peer.port}`;
    return {
      action: "connect",
      url,
      reason: `discovered via mDNS at ${url}`,
      transportLabel: "mdns",
    };
  }

  /**
   * Full evaluation: check trust store + connection state + rate limiting.
   * Returns a decision about whether to auto-connect.
   */
  async evaluateWithTrust(peer: MeshDiscoveredPeer): Promise<AutoConnectDecision> {
    // Check trust store first
    const trusted = await isTrustedPeer(peer.deviceId);
    if (!trusted) {
      return { action: "skip", reason: "peer not in trust store" };
    }

    return this.evaluate(peer);
  }

  /**
   * Get the number of recent connection attempts for a peer.
   */
  getAttemptCount(deviceId: string): number {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const history = this.attempts.get(deviceId) ?? [];
    return history.filter((t) => t > oneHourAgo).length;
  }

  /**
   * Reset all tracking state.
   */
  reset(): void {
    this.attempts.clear();
    this.connectedPeers.clear();
    this.deadPeers.clear();
  }
}
