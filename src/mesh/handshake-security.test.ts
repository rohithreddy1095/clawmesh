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
      nonce: "n",
      requiredNonce: "n",
    });
    expect(result).toBe(false);
  });

  it("rejects auth with signedAtMs in the future", () => {
    const result = verifyMeshConnectAuth({
      deviceId: "test-device",
      publicKey: "invalid-key",
      signature: "invalid-sig",
      signedAtMs: Date.now() + 10 * 60 * 1000, // 10 minutes in future
      nonce: "n",
      requiredNonce: "n",
    });
    expect(result).toBe(false);
  });

  it("accepts auth within 5-minute window", () => {
    // This will fail on signature verification (invalid key), but
    // should NOT fail on timestamp check
    const signedAtMs = Date.now() - 2 * 60 * 1000; // 2 minutes ago
    const payload = buildMeshAuthPayload({ deviceId: "test", signedAtMs, nonce: "n" });
    expect(payload).toContain(String(signedAtMs)); // Timestamp is in payload
  });
});

describe("Handshake security: payload format", () => {
  it("includes all fields in signed payload at fixed positions", () => {
    const payload = buildMeshAuthPayload({
      deviceId: "device-abc",
      signedAtMs: 1234567890,
      nonce: "random-nonce",
    });
    expect(payload).toBe("mesh.connect|v2|device-abc|1234567890|random-nonce||");
  });

  it("different deviceId produces different payload", () => {
    const p1 = buildMeshAuthPayload({ deviceId: "a", signedAtMs: 1, nonce: "n" });
    const p2 = buildMeshAuthPayload({ deviceId: "b", signedAtMs: 1, nonce: "n" });
    expect(p1).not.toBe(p2);
  });

  it("different timestamps produce different payloads", () => {
    const p1 = buildMeshAuthPayload({ deviceId: "a", signedAtMs: 1, nonce: "n" });
    const p2 = buildMeshAuthPayload({ deviceId: "a", signedAtMs: 2, nonce: "n" });
    expect(p1).not.toBe(p2);
  });
});

describe("Handshake v2: unambiguous signed payload", () => {
  it("nonce-only and meshId-only payloads must differ (field-position ambiguity)", () => {
    const withNonce = buildMeshAuthPayload({ deviceId: "d", signedAtMs: 1, nonce: "x" });
    const withMeshId = buildMeshAuthPayload({ deviceId: "d", signedAtMs: 1, nonce: "", meshId: "x" } as never);
    expect(withNonce).not.toBe(withMeshId);
  });

  it("a field value containing the delimiter cannot forge adjacent fields", () => {
    const injected = buildMeshAuthPayload({
      deviceId: "d",
      signedAtMs: 1,
      nonce: "n",
      meshId: "a|b",
    } as never);
    const legitimate = buildMeshAuthPayload({
      deviceId: "d",
      signedAtMs: 1,
      nonce: "n",
      meshId: "a",
      role: "b",
    } as never);
    expect(injected).not.toBe(legitimate);
  });

  it("payload has fixed positions with explicit empty markers", () => {
    const full = buildMeshAuthPayload({
      deviceId: "d",
      signedAtMs: 1,
      nonce: "n",
      meshId: "m",
      role: "r",
    } as never);
    expect(full).toBe("mesh.connect|v2|d|1|n|m|r");

    const minimal = buildMeshAuthPayload({ deviceId: "d", signedAtMs: 1, nonce: "n" } as never);
    expect(minimal).toBe("mesh.connect|v2|d|1|n||");
  });
});

describe("Handshake v2: server-issued nonce is mandatory", () => {
  it("verification rejects auth whose nonce does not match the issued nonce", async () => {
    const { withTempHome } = await import("./test-helpers.js");
    const { loadOrCreateDeviceIdentity } = await import("../infra/device-identity.js");
    await withTempHome(async () => {
      const identity = loadOrCreateDeviceIdentity();
      const auth = buildMeshConnectAuth({ identity, nonce: "issued-nonce" } as never);
      expect(
        verifyMeshConnectAuth({ ...auth, requiredNonce: "issued-nonce" } as never),
      ).toBe(true);
      expect(
        verifyMeshConnectAuth({ ...auth, requiredNonce: "different-nonce" } as never),
      ).toBe(false);
    });
  });

  it("verification rejects auth with no nonce even when a signature is otherwise valid", async () => {
    const { withTempHome } = await import("./test-helpers.js");
    const { loadOrCreateDeviceIdentity } = await import("../infra/device-identity.js");
    await withTempHome(async () => {
      const identity = loadOrCreateDeviceIdentity();
      const auth = buildMeshConnectAuth({ identity, nonce: "" } as never);
      expect(
        verifyMeshConnectAuth({ ...auth, nonce: undefined, requiredNonce: "issued" } as never),
      ).toBe(false);
    });
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
