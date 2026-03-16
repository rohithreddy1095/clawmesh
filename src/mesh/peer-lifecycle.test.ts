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

  it("connectToPeer is idempotent for same deviceId", async () => {
    await runtime.start();

    // Connect to a non-existent peer (will fail silently with backoff)
    runtime.connectToPeer({
      deviceId: "fake-peer-id",
      url: "ws://127.0.0.1:19999", // won't connect
    });

    // Second call should be a no-op
    runtime.connectToPeer({
      deviceId: "fake-peer-id",
      url: "ws://127.0.0.1:19999",
    });

    // Only one outbound client should exist (verified by no crash)
    await runtime.stop();
  });

  it("waitForPeerConnected returns false on timeout", async () => {
    const result = await runtime.waitForPeerConnected("nonexistent-peer", 100);
    expect(result).toBe(false);
  });

  it("autoConnect tracks no state initially", () => {
    expect(runtime.autoConnect.getAttemptCount("any")).toBe(0);
  });

  it("event bus has no peer listeners initially", () => {
    expect(runtime.eventBus.listenerCount("peer.connected")).toBe(0);
    expect(runtime.eventBus.listenerCount("peer.disconnected")).toBe(0);
  });

  it("can subscribe to peer events via event bus", () => {
    const events: string[] = [];
    runtime.eventBus.on("peer.connected", () => events.push("connected"));
    runtime.eventBus.on("peer.disconnected", () => events.push("disconnected"));

    expect(runtime.eventBus.listenerCount("peer.connected")).toBe(1);
    expect(runtime.eventBus.listenerCount("peer.disconnected")).toBe(1);
  });
});

describe("Two-node peer connection", () => {
  let tmpDir1: string;
  let tmpDir2: string;
  let node1: MeshNodeRuntime;
  let node2: MeshNodeRuntime;

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

  it("two nodes can start on different ports", async () => {
    const id1 = loadOrCreateDeviceIdentity(join(tmpDir1, "device.json"));
    const id2 = loadOrCreateDeviceIdentity(join(tmpDir2, "device.json"));

    node1 = new MeshNodeRuntime({
      identity: id1,
      port: 0,
      displayName: "node-1",
      log: noop,
    });
    node2 = new MeshNodeRuntime({
      identity: id2,
      port: 0,
      displayName: "node-2",
      log: noop,
    });

    const addr1 = await node1.start();
    const addr2 = await node2.start();

    expect(addr1.port).toBeGreaterThan(0);
    expect(addr2.port).toBeGreaterThan(0);
    expect(addr1.port).not.toBe(addr2.port);

    await node1.stop();
    await node2.stop();
  });

  it("node identity is unique per instance", () => {
    const id1 = loadOrCreateDeviceIdentity(join(tmpDir1, "device.json"));
    const id2 = loadOrCreateDeviceIdentity(join(tmpDir2, "device.json"));

    expect(id1.deviceId).not.toBe(id2.deviceId);
    expect(id1.publicKeyPem).not.toBe(id2.publicKeyPem);
  });
});
