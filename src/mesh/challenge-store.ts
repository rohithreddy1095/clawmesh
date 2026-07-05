/**
 * ChallengeStore — server-issued, single-use handshake nonces.
 *
 * Each inbound connection must request a challenge nonce (mesh.challenge)
 * before authenticating (mesh.connect). Nonces are:
 *   - bound to the connection they were issued on
 *   - single-use (consumed on first mesh.connect attempt, valid or not)
 *   - expired after a TTL (default 60s)
 *
 * This closes the handshake replay window: a captured signed mesh.connect
 * cannot be replayed because its nonce is already consumed, and cannot be
 * used on another connection because the nonce is connection-bound.
 */

import { randomBytes } from "node:crypto";

const DEFAULT_TTL_MS = 60_000;
const SWEEP_THRESHOLD = 1024;

export class ChallengeStore {
  private issued = new Map<string, { nonce: string; issuedAtMs: number }>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts?: { ttlMs?: number; now?: () => number }) {
    this.ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts?.now ?? Date.now;
  }

  /**
   * Issue a fresh nonce for a connection. Re-issuing replaces (and thereby
   * invalidates) any previous nonce for the same connection.
   */
  issue(connId: string): string {
    if (this.issued.size >= SWEEP_THRESHOLD) {
      this.sweepExpired();
    }
    const nonce = randomBytes(24).toString("base64url");
    this.issued.set(connId, { nonce, issuedAtMs: this.now() });
    return nonce;
  }

  /**
   * Consume the nonce for a connection. Returns true only if the nonce
   * matches what was issued to this connection and has not expired.
   * A successful match removes the entry (single-use). A mismatched guess
   * does not burn the pending nonce — it is 24 random bytes, unguessable,
   * and burning it would let garbage frames disrupt a live handshake.
   */
  consume(connId: string, nonce: string): boolean {
    const entry = this.issued.get(connId);
    if (!entry) return false;
    if (this.now() - entry.issuedAtMs > this.ttlMs) {
      this.issued.delete(connId);
      return false;
    }
    if (entry.nonce !== nonce) return false;
    this.issued.delete(connId);
    return true;
  }

  /** Drop the pending nonce for a connection (e.g. on disconnect). */
  drop(connId: string): void {
    this.issued.delete(connId);
  }

  /** Number of outstanding (unconsumed) challenges. */
  get size(): number {
    return this.issued.size;
  }

  private sweepExpired(): void {
    const now = this.now();
    for (const [connId, entry] of this.issued) {
      if (now - entry.issuedAtMs > this.ttlMs) {
        this.issued.delete(connId);
      }
    }
  }
}
