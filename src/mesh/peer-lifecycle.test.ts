/**
 * Peer Lifecycle Tests — validates peer connection/disconnection behaviors
 * through the wired MeshNodeRuntime.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MeshNodeRuntime } from "./node-runtime.js";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const noop = { info: () => {}, warn: () => {}, error: () => {} };

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "peer-lifecycle-test-"));
}

describe("Peer Lifecycle via MeshNodeRuntime", () => {
  let tmpDir: string;
  let runtime: MeshNodeRuntime;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const identity = loadOrCreateDeviceIdentity(join(tmpDir, "device.json"));
    runtime = new MeshNodeRuntime({
      identity,
      port: 0,
      displayName: "lifecycle-test",
      log: noop,
    });
  });

  afterEach(async () => {
    await runtime.stop();
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it("starts with no connected peers", () => {
    expect(runtime.listConnectedPeers()).toHaveLength(0);
  });

  it("connectToPeer delegates to peerConnections manager", () => {
    // The PeerConnectionManager handles idempotency
    runtime.connectToPeer({
      deviceId: "fake-peer-id",
      url: "ws://127.0.0.1:19999",
    });
    expect(runtime.peerConnections.has("fake-peer-id")).toBe(true);

    // Second call is idempotent
    runtime.connectToPeer({
      deviceId: "fake-peer-id",
      url: "ws://127.0.0.1:19999",
    });
    expect(runtime.peerConnections.size).toBe(1);

    runtime.peerConnections.stopAll();
  });

  it("waitForPeerConnected returns false on timeout", async () => {
    const result = await runtime.waitForPeerConnected("nonexistent-peer", 100);
    expect(result).toBe(false);
  });

  it("autoConnect tracks no state initially", () => {
    expect(runtime.autoConnect.getAttemptCount("any")).toBe(0);
  });

  it("event bus has system listeners for peer events (event log wiring)", () => {
    // Runtime now wires system event log listeners during construction
    expect(runtime.eventBus.listenerCount("peer.connected")).toBeGreaterThanOrEqual(1);
    expect(runtime.eventBus.listenerCount("peer.disconnected")).toBeGreaterThanOrEqual(1);
  });

  it("can subscribe to peer events via event bus", () => {
    const events: string[] = [];
    runtime.eventBus.on("peer.connected", () => events.push("connected"));
    runtime.eventBus.on("peer.disconnected", () => events.push("disconnected"));

    expect(runtime.eventBus.listenerCount("peer.connected")).toBeGreaterThanOrEqual(2);
    expect(runtime.eventBus.listenerCount("peer.disconnected")).toBeGreaterThanOrEqual(2);
  });
});

describe("Two-node peer connection", () => {
  let tmpDir1: string;
  let tmpDir2: string;
  let node1: MeshNodeRuntime | undefined;
  let node2: MeshNodeRuntime | undefined;

  beforeEach(() => {
    tmpDir1 = makeTempDir();
    tmpDir2 = makeTempDir();
  });

  afterEach(async () => {
    await node1?.stop();
    await node2?.stop();
    try { rmSync(tmpDir1, { recursive: true }); } catch {}
    try { rmSync(tmpDir2, { recursive: true }); } catch {}
  });

  it("two nodes get unique identities", () => {
    const id1 = loadOrCreateDeviceIdentity(join(tmpDir1, "device.json"));
    const id2 = loadOrCreateDeviceIdentity(join(tmpDir2, "device.json"));

    // Different keys = different device IDs
    expect(id1.deviceId).not.toBe(id2.deviceId);
    expect(id1.publicKeyPem).not.toBe(id2.publicKeyPem);

    // Both are valid SHA256 hex
    expect(id1.deviceId).toMatch(/^[a-f0-9]{64}$/);
    expect(id2.deviceId).toMatch(/^[a-f0-9]{64}$/);
  });

  it("runtime can be created without starting", () => {
    const id1 = loadOrCreateDeviceIdentity(join(tmpDir1, "device.json"));
    node1 = new MeshNodeRuntime({
      identity: id1,
      port: 0,
      displayName: "no-start",
      log: noop,
    });
    expect(node1.displayName).toBe("no-start");
    expect(node1.identity.deviceId).toBe(id1.deviceId);
  });
});
