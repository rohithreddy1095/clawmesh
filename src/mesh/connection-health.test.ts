/**
 * Tests for ConnectionHealthMonitor — stale peer detection and cleanup.
 */

import { describe, it, expect } from "vitest";
import { ConnectionHealthMonitor } from "./connection-health.js";

describe("ConnectionHealthMonitor", () => {
  it("starts with no tracked peers", () => {
    const mon = new ConnectionHealthMonitor();
    expect(mon.trackedPeers).toBe(0);
  });

  it("recordActivity tracks peer", () => {
    const mon = new ConnectionHealthMonitor();
    mon.recordActivity("peer-01");
    expect(mon.trackedPeers).toBe(1);
  });

  it("checkAll returns empty when no peers are stale", () => {
    const mon = new ConnectionHealthMonitor({ staleThresholdMs: 60_000 });
    mon.recordActivity("peer-01");
    const stale = mon.checkAll();
    expect(stale).toHaveLength(0);
  });

  it("checkAll detects stale peers", () => {
    const mon = new ConnectionHealthMonitor({ staleThresholdMs: 1000 });
    const now = Date.now();
    mon.recordActivity("peer-01"); // Just now
    // Manually set lastSeen to past
    (mon as any).lastSeen.set("peer-02", now - 5000); // 5 seconds ago

    const stale = mon.checkAll(now);
    expect(stale).toContain("peer-02");
    expect(stale).not.toContain("peer-01");
  });

  it("stale peers are removed after checkAll", () => {
    const mon = new ConnectionHealthMonitor({ staleThresholdMs: 100 });
    const now = Date.now();
    (mon as any).lastSeen.set("peer-old", now - 200);
    mon.checkAll(now);
    expect(mon.trackedPeers).toBe(0); // Removed
  });

  it("onStaleDetected callback fires for stale peers", () => {
    const detected: string[] = [];
    const mon = new ConnectionHealthMonitor({
      staleThresholdMs: 100,
      onStaleDetected: (id) => detected.push(id),
    });
    const now = Date.now();
    (mon as any).lastSeen.set("peer-stale", now - 200);
    mon.checkAll(now);
    expect(detected).toContain("peer-stale");
  });

  it("removePeer stops tracking", () => {
    const mon = new ConnectionHealthMonitor();
    mon.recordActivity("peer-01");
    expect(mon.trackedPeers).toBe(1);
    mon.removePeer("peer-01");
    expect(mon.trackedPeers).toBe(0);
  });

  it("getTimeSinceActivity returns elapsed time", () => {
    const mon = new ConnectionHealthMonitor();
    const now = Date.now();
    (mon as any).lastSeen.set("peer-01", now - 5000);
    const elapsed = mon.getTimeSinceActivity("peer-01", now);
    expect(elapsed).toBe(5000);
  });

  it("getTimeSinceActivity returns null for unknown peer", () => {
    const mon = new ConnectionHealthMonitor();
    expect(mon.getTimeSinceActivity("unknown")).toBeNull();
  });

  it("isStale returns true for stale peer", () => {
    const mon = new ConnectionHealthMonitor({ staleThresholdMs: 1000 });
    const now = Date.now();
    (mon as any).lastSeen.set("peer-01", now - 2000);
    expect(mon.isStale("peer-01", now)).toBe(true);
  });

  it("isStale returns false for active peer", () => {
    const mon = new ConnectionHealthMonitor({ staleThresholdMs: 5000 });
    mon.recordActivity("peer-01");
    expect(mon.isStale("peer-01")).toBe(false);
  });

  it("isStale returns false for unknown peer", () => {
    const mon = new ConnectionHealthMonitor();
    expect(mon.isStale("unknown")).toBe(false);
  });

  it("getStats tracks check count", () => {
    const mon = new ConnectionHealthMonitor();
    mon.checkAll();
    mon.checkAll();
    const stats = mon.getStats();
    expect(stats.totalChecks).toBe(2);
  });

  it("getStats tracks stale removal count", () => {
    const mon = new ConnectionHealthMonitor({ staleThresholdMs: 100 });
    const now = Date.now();
    (mon as any).lastSeen.set("p1", now - 200);
    (mon as any).lastSeen.set("p2", now - 200);
    mon.checkAll(now);
    expect(mon.getStats().staleRemoved).toBe(2);
  });

  it("multiple activity records update last seen", () => {
    const mon = new ConnectionHealthMonitor({ staleThresholdMs: 5000 });
    const now = Date.now();
    (mon as any).lastSeen.set("peer-01", now - 10000); // Old
    mon.recordActivity("peer-01"); // Refresh
    expect(mon.isStale("peer-01", now)).toBe(false); // No longer stale
  });

  it("checkAll with no tracked peers is safe", () => {
    const mon = new ConnectionHealthMonitor();
    expect(mon.checkAll()).toEqual([]);
  });

  it("removePeer for unknown peer is safe", () => {
    const mon = new ConnectionHealthMonitor();
    mon.removePeer("nonexistent"); // Should not throw
    expect(mon.trackedPeers).toBe(0);
  });
});
