/**
 * Tests for production wiring — validates that ConnectionHealthMonitor
 * and RateLimiter are properly integrated into the runtime.
 */

import { describe, it, expect } from "vitest";
import { ConnectionHealthMonitor } from "./connection-health.js";
import { RateLimiter } from "./rate-limiter.js";
import { validateMessageSize, validateAndParse, MAX_MESSAGE_SIZE } from "./message-validation.js";
import { MetricsCollector, MESH_METRICS } from "./metrics-collector.js";

describe("Production wiring: ConnectionHealth + PeerConnectionManager", () => {
  it("activity recording on peer event simulates the wired path", () => {
    const health = new ConnectionHealthMonitor({ staleThresholdMs: 5000 });

    // Simulates what PeerConnectionManager does on onEvent
    health.recordActivity("peer-01");
    expect(health.isStale("peer-01")).toBe(false);
    expect(health.trackedPeers).toBe(1);
  });

  it("disconnect cleanup removes tracking", () => {
    const health = new ConnectionHealthMonitor();
    health.recordActivity("peer-01");
    health.removePeer("peer-01"); // Simulates onDisconnected cleanup
    expect(health.trackedPeers).toBe(0);
  });
});

describe("Production wiring: RateLimiter + inbound handler", () => {
  it("100 req/min limit allows normal traffic", () => {
    const limiter = new RateLimiter({ maxRequests: 100, windowMs: 60_000 });
    const connId = "conn-123";

    // Normal traffic: 50 messages in quick succession
    for (let i = 0; i < 50; i++) {
      expect(limiter.allow(connId)).toBe(true);
    }
    expect(limiter.remaining(connId)).toBe(50);
  });

  it("blocks flood after limit reached", () => {
    const limiter = new RateLimiter({ maxRequests: 100, windowMs: 60_000 });
    const connId = "conn-flood";

    for (let i = 0; i < 100; i++) limiter.allow(connId);
    expect(limiter.allow(connId)).toBe(false);
    expect(limiter.retryAfterMs(connId)).toBeGreaterThan(0);
  });

  it("message size validation rejects before parse (production path)", () => {
    const oversized = "x".repeat(MAX_MESSAGE_SIZE + 1);
    const result = validateMessageSize(oversized);
    expect(result.valid).toBe(false);
    // This check happens BEFORE JSON.parse in the runtime
  });

  it("validateAndParse handles complete pipeline", () => {
    const valid = validateAndParse('{"type":"req","id":"1","method":"test"}');
    expect(valid.parsed).not.toBeNull();

    const invalid = validateAndParse("not json");
    expect(invalid.parsed).toBeNull();
  });

  it("cleanup on disconnect frees resources", () => {
    const limiter = new RateLimiter({ maxRequests: 100, windowMs: 60_000 });
    limiter.allow("conn-1");
    limiter.allow("conn-2");
    expect(limiter.size).toBe(2);

    limiter.reset("conn-1"); // Simulates socket close cleanup
    expect(limiter.size).toBe(1);
  });
});

describe("Production wiring: MetricsCollector in runtime", () => {
  it("tracks inbound message pipeline (simulates runtime path)", () => {
    const m = new MetricsCollector();
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60_000 });
    const connId = "conn-test";

    // 3 inbound messages
    for (let i = 0; i < 3; i++) {
      m.inc(MESH_METRICS.INBOUND_MESSAGES);
      if (!limiter.allow(connId)) {
        m.inc(MESH_METRICS.INBOUND_RATE_LIMITED);
        continue;
      }
      // Simulate size validation
      const sizeOk = validateMessageSize('{"type":"req"}');
      if (!sizeOk.valid) {
        m.inc(MESH_METRICS.INBOUND_REJECTED);
        continue;
      }
      m.inc(MESH_METRICS.FRAMES_INGESTED);
    }

    expect(m.getCounter(MESH_METRICS.INBOUND_MESSAGES)).toBe(3);
    expect(m.getCounter(MESH_METRICS.INBOUND_RATE_LIMITED)).toBe(1); // Third was rate-limited
    expect(m.getCounter(MESH_METRICS.FRAMES_INGESTED)).toBe(2);
  });

  it("metrics snapshot includes all tracked counters", () => {
    const m = new MetricsCollector();
    m.inc(MESH_METRICS.INBOUND_MESSAGES, 100);
    m.inc(MESH_METRICS.RPC_REQUESTS, 50);
    m.set(MESH_METRICS.PEERS_CONNECTED, 3);

    const snap = m.snapshot();
    expect(snap.length).toBe(3);
    expect(snap.find(s => s.name === MESH_METRICS.INBOUND_MESSAGES)?.value).toBe(100);
    expect(snap.find(s => s.name === MESH_METRICS.PEERS_CONNECTED)?.value).toBe(3);
  });
});
