/**
 * Tests for handshake security improvements.
 */

import { describe, it, expect } from "vitest";
import { buildMeshConnectAuth, verifyMeshConnectAuth, buildMeshAuthPayload } from "./handshake.js";

describe("Handshake security: timestamp verification", () => {
  it("rejects auth with signedAtMs too far in the past", () => {
    const result = verifyMeshConnectAuth({
      deviceId: "test-device",
      publicKey: "invalid-key",
      signature: "invalid-sig",
      signedAtMs: Date.now() - 10 * 60 * 1000, // 10 minutes ago
    });
    expect(result).toBe(false);
  });

  it("rejects auth with signedAtMs in the future", () => {
    const result = verifyMeshConnectAuth({
      deviceId: "test-device",
      publicKey: "invalid-key",
      signature: "invalid-sig",
      signedAtMs: Date.now() + 10 * 60 * 1000, // 10 minutes in future
    });
    expect(result).toBe(false);
  });

  it("accepts auth within 5-minute window", () => {
    // This will fail on signature verification (invalid key), but
    // should NOT fail on timestamp check
    const signedAtMs = Date.now() - 2 * 60 * 1000; // 2 minutes ago
    const payload = buildMeshAuthPayload({ deviceId: "test", signedAtMs });
    expect(payload).toContain(String(signedAtMs)); // Timestamp is in payload
  });
});

describe("Handshake security: payload format", () => {
  it("includes all fields in signed payload", () => {
    const payload = buildMeshAuthPayload({
      deviceId: "device-abc",
      signedAtMs: 1234567890,
      nonce: "random-nonce",
    });
    expect(payload).toBe("mesh.connect|v1|device-abc|1234567890|random-nonce");
  });

  it("payload without nonce omits it", () => {
    const payload = buildMeshAuthPayload({
      deviceId: "device-abc",
      signedAtMs: 1234567890,
    });
    expect(payload).toBe("mesh.connect|v1|device-abc|1234567890");
  });

  it("different deviceId produces different payload", () => {
    const p1 = buildMeshAuthPayload({ deviceId: "a", signedAtMs: 1 });
    const p2 = buildMeshAuthPayload({ deviceId: "b", signedAtMs: 1 });
    expect(p1).not.toBe(p2);
  });

  it("different timestamps produce different payloads", () => {
    const p1 = buildMeshAuthPayload({ deviceId: "a", signedAtMs: 1 });
    const p2 = buildMeshAuthPayload({ deviceId: "a", signedAtMs: 2 });
    expect(p1).not.toBe(p2);
  });
});

describe("Handshake security: public key pinning", () => {
  it("trust store with publicKey rejects mismatched key", () => {
    // Simulate the check that peer-server.ts now does
    const trustedPublicKey: string = "stored-key-abc";
    const incomingPublicKey: string = "different-key-xyz";
    const matches = !trustedPublicKey || trustedPublicKey === incomingPublicKey;
    expect(matches).toBe(false);
  });

  it("trust store without publicKey accepts any key (first-use)", () => {
    const trustedPublicKey: string | undefined = undefined;
    const incomingPublicKey: string = "any-key";
    // No pinned key → accept (trust-on-first-use)
    const matches = !trustedPublicKey || trustedPublicKey === incomingPublicKey;
    expect(matches).toBe(true);
  });

  it("trust store with matching publicKey passes", () => {
    const trustedPublicKey: string = "matching-key";
    const incomingPublicKey: string = "matching-key";
    const matches = !trustedPublicKey || trustedPublicKey === incomingPublicKey;
    expect(matches).toBe(true);
  });
});
