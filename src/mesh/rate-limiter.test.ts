/**
 * Tests for RateLimiter — sliding window rate limiting.
 */

import { describe, it, expect } from "vitest";
import { RateLimiter } from "./rate-limiter.js";

describe("RateLimiter", () => {
  it("allows requests within limit", () => {
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 });
    expect(limiter.allow("peer-1")).toBe(true);
    expect(limiter.allow("peer-1")).toBe(true);
    expect(limiter.allow("peer-1")).toBe(true);
  });

  it("blocks requests over limit", () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 });
    expect(limiter.allow("peer-1")).toBe(true);
    expect(limiter.allow("peer-1")).toBe(true);
    expect(limiter.allow("peer-1")).toBe(false);
  });

  it("different keys have independent limits", () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000 });
    expect(limiter.allow("peer-1")).toBe(true);
    expect(limiter.allow("peer-2")).toBe(true);
    expect(limiter.allow("peer-1")).toBe(false);
    expect(limiter.allow("peer-2")).toBe(false);
  });

  it("requests expire after window", () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 100 });
    const now = Date.now();
    expect(limiter.allow("peer-1", now)).toBe(true);
    expect(limiter.allow("peer-1", now + 50)).toBe(false); // Still in window
    expect(limiter.allow("peer-1", now + 150)).toBe(true); // Window expired
  });

  it("remaining returns correct count", () => {
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 });
    expect(limiter.remaining("peer-1")).toBe(5);
    limiter.allow("peer-1");
    expect(limiter.remaining("peer-1")).toBe(4);
    limiter.allow("peer-1");
    limiter.allow("peer-1");
    expect(limiter.remaining("peer-1")).toBe(2);
  });

  it("isLimited returns false when under limit", () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 });
    expect(limiter.isLimited("peer-1")).toBe(false);
    limiter.allow("peer-1");
    expect(limiter.isLimited("peer-1")).toBe(false);
  });

  it("isLimited returns true when at limit", () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000 });
    limiter.allow("peer-1");
    expect(limiter.isLimited("peer-1")).toBe(true);
  });

  it("isLimited does not consume a request", () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000 });
    limiter.isLimited("peer-1"); // Should not consume
    expect(limiter.allow("peer-1")).toBe(true);
  });

  it("retryAfterMs returns 0 when not limited", () => {
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 });
    expect(limiter.retryAfterMs("peer-1")).toBe(0);
  });

  it("retryAfterMs returns time until window expires", () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000 });
    const now = Date.now();
    limiter.allow("peer-1", now);
    const retry = limiter.retryAfterMs("peer-1", now + 200);
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(800);
  });

  it("reset clears limits for a key", () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000 });
    limiter.allow("peer-1");
    expect(limiter.allow("peer-1")).toBe(false);
    limiter.reset("peer-1");
    expect(limiter.allow("peer-1")).toBe(true);
  });

  it("resetAll clears all limits", () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000 });
    limiter.allow("peer-1");
    limiter.allow("peer-2");
    limiter.resetAll();
    expect(limiter.size).toBe(0);
    expect(limiter.allow("peer-1")).toBe(true);
  });

  it("size tracks active keys", () => {
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 });
    expect(limiter.size).toBe(0);
    limiter.allow("peer-1");
    expect(limiter.size).toBe(1);
    limiter.allow("peer-2");
    expect(limiter.size).toBe(2);
  });

  it("expired keys are cleaned up", () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 100 });
    const now = Date.now();
    limiter.allow("peer-1", now);
    expect(limiter.size).toBe(1);
    limiter.remaining("peer-1", now + 200); // Triggers cleanup
    expect(limiter.size).toBe(0);
  });

  it("handles high-frequency bursts correctly", () => {
    const limiter = new RateLimiter({ maxRequests: 100, windowMs: 1000 });
    const now = Date.now();
    let allowed = 0;
    for (let i = 0; i < 150; i++) {
      if (limiter.allow("peer-1", now)) allowed++;
    }
    expect(allowed).toBe(100);
  });
});
