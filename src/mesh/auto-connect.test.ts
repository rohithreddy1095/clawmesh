import { describe, it, expect, beforeEach } from "vitest";
import { AutoConnectManager } from "./auto-connect.js";
import type { MeshDiscoveredPeer } from "./discovery.js";

function makePeer(overrides?: Partial<MeshDiscoveredPeer>): MeshDiscoveredPeer {
  return {
    deviceId: "peer-device-id-123",
    displayName: "test-peer",
    host: "192.168.1.39",
    port: 18789,
    discoveredAtMs: Date.now(),
    ...overrides,
  };
}

describe("AutoConnectManager", () => {
  let manager: AutoConnectManager;

  beforeEach(() => {
    manager = new AutoConnectManager();
  });

  // ─── Basic evaluation ──────────────────────

  it("decides to connect for new discovered peer", () => {
    const decision = manager.evaluate(makePeer());
    expect(decision.action).toBe("connect");
    if (decision.action === "connect") {
      expect(decision.url).toBe("ws://192.168.1.39:18789");
      expect(decision.reason).toContain("mDNS");
    }
  });

  it("skips already connected peers", () => {
    const peer = makePeer();
    manager.markConnected(peer.deviceId);

    const decision = manager.evaluate(peer);
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("already connected");
    }
  });

  it("allows reconnect after markDisconnected", () => {
    const peer = makePeer();
    manager.markConnected(peer.deviceId);
    manager.markDisconnected(peer.deviceId);

    const decision = manager.evaluate(peer);
    expect(decision.action).toBe("connect");
  });

  // ─── Rate limiting ─────────────────────────

  it("rate limits after max attempts per hour", () => {
    const peer = makePeer();
    const smallManager = new AutoConnectManager({ maxAttemptsPerHour: 3 });

    // Trigger 3 connect decisions
    expect(smallManager.evaluate(peer).action).toBe("connect");
    smallManager.markDisconnected(peer.deviceId);
    expect(smallManager.evaluate(peer).action).toBe("connect");
    smallManager.markDisconnected(peer.deviceId);
    expect(smallManager.evaluate(peer).action).toBe("connect");
    smallManager.markDisconnected(peer.deviceId);

    // 4th should be rate limited
    const decision = smallManager.evaluate(peer);
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("rate limited");
    }
  });

  it("tracks attempt count", () => {
    const peer = makePeer();
    expect(manager.getAttemptCount(peer.deviceId)).toBe(0);

    manager.evaluate(peer);
    expect(manager.getAttemptCount(peer.deviceId)).toBe(1);

    manager.evaluate(makePeer({ deviceId: peer.deviceId }));
    // Second attempt for connected peer is skipped since it was marked as connecting
    // But attempt was recorded before connection check
  });

  // ─── Missing host/port ─────────────────────

  it("skips peers with missing host", () => {
    const peer = makePeer({ host: undefined });
    const decision = manager.evaluate(peer);
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("missing host");
    }
  });

  it("skips peers with missing port", () => {
    const peer = makePeer({ port: undefined });
    const decision = manager.evaluate(peer);
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("missing host");
    }
  });

  // ─── Reset ─────────────────────────────────

  it("reset clears all state", () => {
    const peer = makePeer();
    manager.markConnected(peer.deviceId);
    manager.evaluate(makePeer({ deviceId: "other" }));

    manager.reset();

    // Previously connected peer should now be eligible
    const decision = manager.evaluate(peer);
    expect(decision.action).toBe("connect");
    expect(manager.getAttemptCount("other")).toBe(0);
  });

  // ─── URL construction ──────────────────────

  it("constructs correct WebSocket URL", () => {
    const decision = manager.evaluate(makePeer({
      host: "10.0.0.5",
      port: 9999,
    }));
    expect(decision.action).toBe("connect");
    if (decision.action === "connect") {
      expect(decision.url).toBe("ws://10.0.0.5:9999");
    }
  });

  it("handles IPv6 host", () => {
    const decision = manager.evaluate(makePeer({
      host: "::1",
      port: 18789,
    }));
    expect(decision.action).toBe("connect");
    if (decision.action === "connect") {
      expect(decision.url).toBe("ws://::1:18789");
    }
  });

  // ─── Multiple peers ────────────────────────

  it("tracks state independently per peer", () => {
    const peer1 = makePeer({ deviceId: "peer-1" });
    const peer2 = makePeer({ deviceId: "peer-2" });

    manager.markConnected(peer1.deviceId);

    expect(manager.evaluate(peer1).action).toBe("skip");
    expect(manager.evaluate(peer2).action).toBe("connect");
  });
});
