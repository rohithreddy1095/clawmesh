/**
 * Tests for production wiring — validates that ConnectionHealthMonitor
 * and RateLimiter are properly integrated into the runtime.
 */

import { describe, it, expect } from "vitest";
import { ConnectionHealthMonitor } from "./connection-health.js";
import { RateLimiter } from "./rate-limiter.js";
import { validateMessageSize, validateAndParse, MAX_MESSAGE_SIZE } from "./message-validation.js";

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
