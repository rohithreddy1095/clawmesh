import { describe, expect, it, vi, afterEach } from "vitest";
import { withTempHome } from "./test-helpers.js";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { buildMeshConnectAuth, verifyMeshConnectAuth, buildMeshAuthPayload } from "./handshake.js";

const NONCE = "test-challenge-nonce";

describe("mesh handshake (Ed25519, v2 challenge-nonce)", () => {
  afterEach(() => {
    if (vi.isFakeTimers()) {
      vi.useRealTimers();
    }
  });

  it("buildMeshConnectAuth() creates a valid signed payload", async () => {
    await withTempHome(async () => {
      const identity = loadOrCreateDeviceIdentity();
      const auth = buildMeshConnectAuth({ identity, nonce: NONCE });
      expect(auth.deviceId).toBe(identity.deviceId);
      expect(auth.publicKey).toBeTruthy();
      expect(auth.signature).toBeTruthy();
      expect(auth.signedAtMs).toBeGreaterThan(0);
      expect(auth.nonce).toBe(NONCE);
    });
  });

  it("verifyMeshConnectAuth() accepts a valid signature over the issued nonce", async () => {
    await withTempHome(async () => {
      const identity = loadOrCreateDeviceIdentity();
      const auth = buildMeshConnectAuth({ identity, nonce: NONCE });
      expect(
        verifyMeshConnectAuth({
          deviceId: auth.deviceId,
          publicKey: auth.publicKey,
          signature: auth.signature,
          signedAtMs: auth.signedAtMs,
          nonce: auth.nonce,
          requiredNonce: NONCE,
        }),
      ).toBe(true);
    });
  });

  it("verifyMeshConnectAuth() rejects an invalid signature", async () => {
    await withTempHome(async () => {
      const identity = loadOrCreateDeviceIdentity();
      const auth = buildMeshConnectAuth({ identity, nonce: NONCE });
      expect(
        verifyMeshConnectAuth({
          deviceId: auth.deviceId,
          publicKey: auth.publicKey,
          signature: "invalid-signature-data",
          signedAtMs: auth.signedAtMs,
          nonce: auth.nonce,
          requiredNonce: NONCE,
        }),
      ).toBe(false);
    });
  });

  it("verifyMeshConnectAuth() rejects expired timestamp (>5 min)", async () => {
    await withTempHome(async () => {
      const identity = loadOrCreateDeviceIdentity();
      const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
      const { signDevicePayload, publicKeyRawBase64UrlFromPem } = await import(
        "../infra/device-identity.js"
      );
      const payload = buildMeshAuthPayload({
        deviceId: identity.deviceId,
        signedAtMs: sixMinutesAgo,
        nonce: NONCE,
      });
      const signature = signDevicePayload(identity.privateKeyPem, payload);
      expect(
        verifyMeshConnectAuth({
          deviceId: identity.deviceId,
          publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
          signature,
          signedAtMs: sixMinutesAgo,
          nonce: NONCE,
          requiredNonce: NONCE,
        }),
      ).toBe(false);
    });
  });

  it("verifyMeshConnectAuth() accepts near-edge timestamp (4 min)", async () => {
    await withTempHome(async () => {
      const identity = loadOrCreateDeviceIdentity();
      const fourMinutesAgo = Date.now() - 4 * 60 * 1000;
      const { signDevicePayload, publicKeyRawBase64UrlFromPem } = await import(
        "../infra/device-identity.js"
      );
      const payload = buildMeshAuthPayload({
        deviceId: identity.deviceId,
        signedAtMs: fourMinutesAgo,
        nonce: NONCE,
      });
      const signature = signDevicePayload(identity.privateKeyPem, payload);
      expect(
        verifyMeshConnectAuth({
          deviceId: identity.deviceId,
          publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
          signature,
          signedAtMs: fourMinutesAgo,
          nonce: NONCE,
          requiredNonce: NONCE,
        }),
      ).toBe(true);
    });
  });

  it("round-trip: build then verify succeeds", async () => {
    await withTempHome(async () => {
      const identity = loadOrCreateDeviceIdentity();
      const auth = buildMeshConnectAuth({ identity, nonce: NONCE, displayName: "Mac Gateway" });
      expect(
        verifyMeshConnectAuth({
          deviceId: auth.deviceId,
          publicKey: auth.publicKey,
          signature: auth.signature,
          signedAtMs: auth.signedAtMs,
          nonce: auth.nonce,
          requiredNonce: NONCE,
        }),
      ).toBe(true);
    });
  });

  it("verification fails when nonce differs from the one the verifier issued", async () => {
    await withTempHome(async () => {
      const identity = loadOrCreateDeviceIdentity();
      const auth = buildMeshConnectAuth({ identity, nonce: "attacker-chosen" });
      expect(
        verifyMeshConnectAuth({
          deviceId: auth.deviceId,
          publicKey: auth.publicKey,
          signature: auth.signature,
          signedAtMs: auth.signedAtMs,
          nonce: auth.nonce,
          requiredNonce: NONCE,
        }),
      ).toBe(false);
    });
  });

  it("verification fails when nonce is absent", async () => {
    await withTempHome(async () => {
      const identity = loadOrCreateDeviceIdentity();
      const auth = buildMeshConnectAuth({ identity, nonce: NONCE });
      expect(
        verifyMeshConnectAuth({
          deviceId: auth.deviceId,
          publicKey: auth.publicKey,
          signature: auth.signature,
          signedAtMs: auth.signedAtMs,
          requiredNonce: NONCE,
        }),
      ).toBe(false);
    });
  });
});
