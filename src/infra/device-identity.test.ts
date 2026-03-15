import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadOrCreateDeviceIdentity,
  signDevicePayload,
  verifyDeviceSignature,
  publicKeyRawBase64UrlFromPem,
  deriveDeviceIdFromPublicKey,
  normalizeDevicePublicKeyBase64Url,
  type DeviceIdentity,
} from "./device-identity.js";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "device-identity-test-"));
}

describe("loadOrCreateDeviceIdentity", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it("creates a new identity when file does not exist", () => {
    const path = join(tmpDir, "identity", "device.json");
    const identity = loadOrCreateDeviceIdentity(path);

    expect(identity.deviceId).toBeTruthy();
    expect(identity.deviceId.length).toBe(64); // SHA256 hex
    expect(identity.publicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(identity.privateKeyPem).toContain("BEGIN PRIVATE KEY");
    expect(existsSync(path)).toBe(true);
  });

  it("loads existing identity from file", () => {
    const path = join(tmpDir, "device.json");
    const first = loadOrCreateDeviceIdentity(path);
    const second = loadOrCreateDeviceIdentity(path);

    expect(second.deviceId).toBe(first.deviceId);
    expect(second.publicKeyPem).toBe(first.publicKeyPem);
    expect(second.privateKeyPem).toBe(first.privateKeyPem);
  });

  it("generates unique identities for different files", () => {
    const id1 = loadOrCreateDeviceIdentity(join(tmpDir, "a.json"));
    const id2 = loadOrCreateDeviceIdentity(join(tmpDir, "b.json"));

    expect(id1.deviceId).not.toBe(id2.deviceId);
  });
});

describe("signDevicePayload / verifyDeviceSignature", () => {
  let identity: DeviceIdentity;

  beforeEach(() => {
    const tmpDir = makeTempDir();
    identity = loadOrCreateDeviceIdentity(join(tmpDir, "test.json"));
  });

  it("sign and verify round-trip succeeds", () => {
    const payload = "mesh.connect|v1|test|12345";
    const signature = signDevicePayload(identity.privateKeyPem, payload);

    const isValid = verifyDeviceSignature(
      identity.publicKeyPem,
      payload,
      signature,
    );
    expect(isValid).toBe(true);
  });

  it("verification fails for wrong payload", () => {
    const signature = signDevicePayload(identity.privateKeyPem, "correct");
    const isValid = verifyDeviceSignature(
      identity.publicKeyPem,
      "wrong",
      signature,
    );
    expect(isValid).toBe(false);
  });

  it("verification fails for wrong key", () => {
    const tmpDir = makeTempDir();
    const otherIdentity = loadOrCreateDeviceIdentity(join(tmpDir, "other.json"));

    const payload = "test payload";
    const signature = signDevicePayload(identity.privateKeyPem, payload);

    const isValid = verifyDeviceSignature(
      otherIdentity.publicKeyPem,
      payload,
      signature,
    );
    expect(isValid).toBe(false);
  });

  it("signature is base64url encoded", () => {
    const signature = signDevicePayload(identity.privateKeyPem, "test");
    // Base64url should not contain +, /, or =
    expect(signature).not.toMatch(/[+/=]/);
  });
});

describe("publicKeyRawBase64UrlFromPem", () => {
  it("extracts raw public key as base64url", () => {
    const tmpDir = makeTempDir();
    const identity = loadOrCreateDeviceIdentity(join(tmpDir, "test.json"));

    const raw = publicKeyRawBase64UrlFromPem(identity.publicKeyPem);
    expect(raw).toBeTruthy();
    expect(raw.length).toBeGreaterThan(0);
    // Should not contain PEM markers
    expect(raw).not.toContain("BEGIN");
  });
});

describe("deriveDeviceIdFromPublicKey", () => {
  it("derives consistent deviceId from PEM", () => {
    const tmpDir = makeTempDir();
    const identity = loadOrCreateDeviceIdentity(join(tmpDir, "test.json"));

    const derived = deriveDeviceIdFromPublicKey(identity.publicKeyPem);
    expect(derived).toBe(identity.deviceId);
  });

  it("derives consistent deviceId from base64url raw key", () => {
    const tmpDir = makeTempDir();
    const identity = loadOrCreateDeviceIdentity(join(tmpDir, "test.json"));

    const raw = publicKeyRawBase64UrlFromPem(identity.publicKeyPem);
    const derived = deriveDeviceIdFromPublicKey(raw);
    expect(derived).toBe(identity.deviceId);
  });

  it("handles arbitrary strings without crashing", () => {
    // The function tries to derive a deviceId from any input
    // For invalid keys it may return a hash rather than null
    const derived = deriveDeviceIdFromPublicKey("not-a-key");
    // Should either return null or a hex string
    if (derived !== null) {
      expect(typeof derived).toBe("string");
      expect(derived.length).toBe(64); // SHA256 hex
    }
  });
});

describe("normalizeDevicePublicKeyBase64Url", () => {
  it("normalizes PEM to base64url", () => {
    const tmpDir = makeTempDir();
    const identity = loadOrCreateDeviceIdentity(join(tmpDir, "test.json"));

    const normalized = normalizeDevicePublicKeyBase64Url(identity.publicKeyPem);
    expect(normalized).toBeTruthy();
    expect(normalized).not.toContain("BEGIN");
  });

  it("normalizes base64url to itself", () => {
    const tmpDir = makeTempDir();
    const identity = loadOrCreateDeviceIdentity(join(tmpDir, "test.json"));

    const raw = publicKeyRawBase64UrlFromPem(identity.publicKeyPem);
    const normalized = normalizeDevicePublicKeyBase64Url(raw);
    expect(normalized).toBe(raw);
  });
});
