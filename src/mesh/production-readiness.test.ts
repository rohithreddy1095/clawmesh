/**
 * Production readiness validation — validates that all production-critical
 * modules have proper error handling and configuration validation.
 */

import { describe, it, expect } from "vitest";
import { RateLimiter } from "../mesh/rate-limiter.js";
import { ConnectionHealthMonitor } from "../mesh/connection-health.js";
import {
  validateStartupConfig,
  hasBlockingDiagnostics,
  formatDiagnostics,
} from "../cli/startup-validation.js";

describe("Production: Rate limiter + connection health integration", () => {
  it("rate limit resets when peer reconnects", () => {
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60_000 });
    const health = new ConnectionHealthMonitor({ staleThresholdMs: 30_000 });

    // Peer makes requests
    for (let i = 0; i < 5; i++) limiter.allow("peer-01");
    expect(limiter.isLimited("peer-01")).toBe(true);

    // Peer disconnects and reconnects (health monitor cleans up)
    health.removePeer("peer-01");
    limiter.reset("peer-01");
    expect(limiter.isLimited("peer-01")).toBe(false);
  });

  it("stale peer triggers rate limit reset", () => {
    const staleRemoved: string[] = [];
    const limiter = new RateLimiter({ maxRequests: 10, windowMs: 60_000 });
    const health = new ConnectionHealthMonitor({
      staleThresholdMs: 100,
      onStaleDetected: (id) => {
        staleRemoved.push(id);
        limiter.reset(id); // Clean up rate limits for dead peers
      },
    });

    // Peer makes some requests
    limiter.allow("peer-01");
    health.recordActivity("peer-01");

    // Simulate staleness
    const now = Date.now();
    (health as any).lastSeen.set("peer-01", now - 200);
    health.checkAll(now);

    expect(staleRemoved).toContain("peer-01");
  });
});

describe("Production: Rate limiter edge cases", () => {
  it("zero maxRequests blocks everything", () => {
    const limiter = new RateLimiter({ maxRequests: 0, windowMs: 1000 });
    expect(limiter.allow("any")).toBe(false);
  });

  it("very short window allows rapid re-requests", () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1 });
    const now = Date.now();
    limiter.allow("peer-1", now);
    // 2ms later, window expired
    expect(limiter.allow("peer-1", now + 2)).toBe(true);
  });

  it("concurrent keys don't interfere", () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
    limiter.allow("a");
    limiter.allow("b");
    limiter.allow("c");
    expect(limiter.remaining("a")).toBe(0);
    expect(limiter.remaining("b")).toBe(0);
    expect(limiter.remaining("c")).toBe(0);
    expect(limiter.remaining("d")).toBe(1); // Never seen
  });
});

describe("Production: Startup validation completeness", () => {
  it("full valid production config passes all checks", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "device-abc123456789",
      port: 18789,
      staticPeers: [
        { deviceId: "peer-xyz", url: "wss://jetson.local:18790" },
      ],
      capabilities: ["sensor:moisture:zone-1", "sensor:temp:zone-1"],
      thresholds: [
        { ruleId: "moisture-low", metric: "soil_moisture" },
        { ruleId: "temp-high", metric: "temperature" },
      ],
      enablePiSession: true,
      hasApiKey: true,
      modelSpec: "anthropic/claude-sonnet-4-5-20250929",
    });

    expect(hasBlockingDiagnostics(diagnostics)).toBe(false);
    // May have info-level diagnostics, but no errors
    expect(diagnostics.filter(d => d.level === "error")).toHaveLength(0);
  });

  it("production config without planner is valid", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "sensor-node-01",
      port: 18789,
      capabilities: ["sensor:moisture"],
      enablePiSession: false,
    });
    expect(hasBlockingDiagnostics(diagnostics)).toBe(false);
  });

  it("format outputs human-readable report", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      port: 80,
      capabilities: [],
      enablePiSession: true,
      hasApiKey: false,
    });
    const report = formatDiagnostics(diagnostics);
    expect(report).toContain("⚠"); // Warnings
    expect(report.split("\n").length).toBeGreaterThan(1); // Multi-line
  });
});
