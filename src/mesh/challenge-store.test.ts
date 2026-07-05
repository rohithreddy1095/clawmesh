/**
 * Tests for the handshake challenge-nonce flow:
 *   ChallengeStore (issue/consume semantics) and the
 *   mesh.challenge → mesh.connect server handler wiring.
 */

import { describe, it, expect } from "vitest";
import { ChallengeStore } from "./challenge-store.js";
import { createMeshServerHandlers } from "./peer-server.js";
import { buildMeshConnectAuth, verifyMeshConnectAuth } from "./handshake.js";
import { PeerRegistry } from "./peer-registry.js";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { addTrustedPeer } from "./peer-trust.js";
import { withTempHome } from "./test-helpers.js";

describe("ChallengeStore", () => {
  it("issues a non-empty nonce bound to a connection", () => {
    const store = new ChallengeStore();
    const nonce = store.issue("conn-1");
    expect(nonce.length).toBeGreaterThanOrEqual(16);
  });

  it("consume succeeds exactly once (single-use)", () => {
    const store = new ChallengeStore();
    const nonce = store.issue("conn-1");
    expect(store.consume("conn-1", nonce)).toBe(true);
    expect(store.consume("conn-1", nonce)).toBe(false); // replay
  });

  it("consume fails for a nonce issued to a different connection", () => {
    const store = new ChallengeStore();
    const nonce = store.issue("conn-1");
    expect(store.consume("conn-2", nonce)).toBe(false);
  });

  it("consume fails after TTL expiry", () => {
    let fakeNow = 1_000_000;
    const store = new ChallengeStore({ ttlMs: 60_000, now: () => fakeNow });
    const nonce = store.issue("conn-1");
    fakeNow += 61_000;
    expect(store.consume("conn-1", nonce)).toBe(false);
  });

  it("re-issuing for the same connection invalidates the previous nonce", () => {
    const store = new ChallengeStore();
    const first = store.issue("conn-1");
    const second = store.issue("conn-1");
    expect(store.consume("conn-1", first)).toBe(false);
    expect(store.consume("conn-1", second)).toBe(true);
  });
});

describe("mesh.challenge → mesh.connect nonce flow", () => {
  async function callHandler(
    handlers: Record<string, (opts: never) => void | Promise<void>>,
    method: string,
    params: Record<string, unknown>,
    connId = "conn-flow",
  ): Promise<{ ok?: boolean; payload?: unknown; error?: { code: string } }> {
    const result: { ok?: boolean; payload?: unknown; error?: { code: string } } = {};
    await handlers[method]({
      req: { _connId: connId, _socket: null },
      params,
      respond: (ok: boolean, payload?: unknown, error?: { code: string }) => {
        result.ok = ok;
        result.payload = payload;
        result.error = error;
      },
    } as never);
    return result;
  }

  it("mesh.challenge issues a nonce", async () => {
    await withTempHome(async () => {
      const identity = loadOrCreateDeviceIdentity();
      const handlers = createMeshServerHandlers({ identity, peerRegistry: new PeerRegistry() });
      const res = await callHandler(handlers as never, "mesh.challenge", {});
      expect(res.ok).toBe(true);
      expect(typeof (res.payload as { nonce?: string })?.nonce).toBe("string");
    });
  });

  it("mesh.connect without a nonce is rejected", async () => {
    await withTempHome(async () => {
      const serverIdentity = loadOrCreateDeviceIdentity();
      const clientIdentity = loadOrCreateDeviceIdentity(
        "/tmp/test-nonce-client-" + Date.now() + "/device.json",
      );
      await addTrustedPeer({ deviceId: clientIdentity.deviceId });
      const handlers = createMeshServerHandlers({
        identity: serverIdentity,
        peerRegistry: new PeerRegistry(),
      });
      const auth = buildMeshConnectAuth({ identity: clientIdentity, nonce: "" } as never);
      const res = await callHandler(handlers as never, "mesh.connect", {
        ...auth,
        clientNonce: "cn",
      });
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe("AUTH_NONCE_REQUIRED");
    });
  });

  it("full flow: challenge → signed connect succeeds; replay of same nonce fails", async () => {
    await withTempHome(async () => {
      const serverIdentity = loadOrCreateDeviceIdentity();
      const clientIdentity = loadOrCreateDeviceIdentity(
        "/tmp/test-nonce-flow-" + Date.now() + "/device.json",
      );
      await addTrustedPeer({ deviceId: clientIdentity.deviceId });
      const handlers = createMeshServerHandlers({
        identity: serverIdentity,
        peerRegistry: new PeerRegistry(),
      });

      const challenge = await callHandler(handlers as never, "mesh.challenge", {});
      const nonce = (challenge.payload as { nonce: string }).nonce;

      const auth = buildMeshConnectAuth({ identity: clientIdentity, nonce } as never);
      const clientNonce = "client-nonce-1";
      const first = await callHandler(handlers as never, "mesh.connect", {
        ...auth,
        clientNonce,
      });
      expect(first.ok).toBe(true);

      // Server's mutual-auth response must sign over OUR clientNonce (anti-replay).
      const serverAuth = first.payload as {
        deviceId: string;
        publicKey: string;
        signature: string;
        signedAtMs: number;
        nonce?: string;
      };
      expect(
        verifyMeshConnectAuth({ ...serverAuth, requiredNonce: clientNonce } as never),
      ).toBe(true);

      // Replaying the identical signed connect must fail: nonce is single-use.
      const replay = await callHandler(handlers as never, "mesh.connect", {
        ...auth,
        clientNonce,
      });
      expect(replay.ok).toBe(false);
    });
  });

  it("a nonce issued to one connection is rejected on another", async () => {
    await withTempHome(async () => {
      const serverIdentity = loadOrCreateDeviceIdentity();
      const clientIdentity = loadOrCreateDeviceIdentity(
        "/tmp/test-nonce-xconn-" + Date.now() + "/device.json",
      );
      await addTrustedPeer({ deviceId: clientIdentity.deviceId });
      const handlers = createMeshServerHandlers({
        identity: serverIdentity,
        peerRegistry: new PeerRegistry(),
      });

      const challenge = await callHandler(handlers as never, "mesh.challenge", {}, "conn-A");
      const nonce = (challenge.payload as { nonce: string }).nonce;
      const auth = buildMeshConnectAuth({ identity: clientIdentity, nonce } as never);
      const res = await callHandler(
        handlers as never,
        "mesh.connect",
        { ...auth, clientNonce: "cn" },
        "conn-B",
      );
      expect(res.ok).toBe(false);
    });
  });
});
