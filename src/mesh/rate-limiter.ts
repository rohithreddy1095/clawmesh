/**
 * RateLimiter — simple token bucket rate limiter for mesh operations.
 *
 * Used to protect against:
 * - Too many inbound connection attempts
 * - RPC flood from a single peer
 * - Context frame spam
 *
 * Uses a sliding window counter approach (simpler than token bucket,
 * more memory-efficient for our use case).
 */

export type RateLimiterConfig = {
  /** Max requests allowed in the window. */
  maxRequests: number;
  /** Window duration in milliseconds. */
  windowMs: number;
};

export class RateLimiter {
  private windows = new Map<string, number[]>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(config: RateLimiterConfig) {
    this.maxRequests = config.maxRequests;
    this.windowMs = config.windowMs;
  }

  /**
   * Check if a request from this key is allowed.
   * Returns true if allowed, false if rate limited.
   * Automatically records the request if allowed.
   */
  allow(key: string, now = Date.now()): boolean {
    this.cleanup(key, now);
    const timestamps = this.windows.get(key) ?? [];
    if (timestamps.length >= this.maxRequests) {
      return false;
    }
    timestamps.push(now);
    this.windows.set(key, timestamps);
    return true;
  }

  /**
   * Check if a key is currently rate limited without recording.
   */
  isLimited(key: string, now = Date.now()): boolean {
    this.cleanup(key, now);
    const timestamps = this.windows.get(key) ?? [];
    return timestamps.length >= this.maxRequests;
  }

  /**
   * Get remaining requests for a key in the current window.
   */
  remaining(key: string, now = Date.now()): number {
    this.cleanup(key, now);
    const timestamps = this.windows.get(key) ?? [];
    return Math.max(0, this.maxRequests - timestamps.length);
  }

  /**
   * Get time until the oldest request in the window expires (ms).
   * Returns 0 if not rate limited.
   */
  retryAfterMs(key: string, now = Date.now()): number {
    this.cleanup(key, now);
    const timestamps = this.windows.get(key) ?? [];
    if (timestamps.length < this.maxRequests) return 0;
    return Math.max(0, timestamps[0] + this.windowMs - now);
  }

  /**
   * Reset rate limit for a specific key.
   */
  reset(key: string): void {
    this.windows.delete(key);
  }

  /**
   * Reset all rate limits.
   */
  resetAll(): void {
    this.windows.clear();
  }

  /**
   * Get number of tracked keys.
   */
  get size(): number {
    return this.windows.size;
  }

  /**
   * Remove expired timestamps for a key.
   */
  private cleanup(key: string, now: number): void {
    const timestamps = this.windows.get(key);
    if (!timestamps) return;
    const cutoff = now - this.windowMs;
    const filtered = timestamps.filter(t => t > cutoff);
    if (filtered.length === 0) {
      this.windows.delete(key);
    } else {
      this.windows.set(key, filtered);
    }
  }
}
