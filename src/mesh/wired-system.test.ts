/**
 * Wired System Tests — validates the complete architecture with all
 * new modules wired into the runtime.
 *
 * These tests exercise the actual MeshNodeRuntime with all integrations:
 * RpcDispatcher, UIBroadcaster, AutoConnect, TrustAudit, EventBus, etc.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MeshNodeRuntime } from "./node-runtime.js";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const noop = { info: () => {}, warn: () => {}, error: () => {} };

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "wired-sys-test-"));
}

describe("Wired MeshNodeRuntime", () => {
  let tmpDir: string;
  let runtime: MeshNodeRuntime;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const identity = loadOrCreateDeviceIdentity(join(tmpDir, "device.json"));
    runtime = new MeshNodeRuntime({
      identity,
      port: 0,
      displayName: "wired-test-node",
      enableMockActuator: true,
      log: noop,
    });
  });

  afterEach(async () => {
    await runtime.stop();
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  // ─── All new properties accessible ────────

  it("exposes all wired modules as public properties", () => {
    expect(runtime.eventBus).toBeDefined();
    expect(runtime.rpcDispatcher).toBeDefined();
    expect(runtime.uiBroadcaster).toBeDefined();
    expect(runtime.autoConnect).toBeDefined();
    expect(runtime.trustAudit).toBeDefined();
    expect(runtime.worldModel).toBeDefined();
    expect(runtime.contextPropagator).toBeDefined();
    expect(runtime.peerRegistry).toBeDefined();
    expect(runtime.capabilityRegistry).toBeDefined();
    expect(runtime.mockActuator).toBeDefined();
    expect(runtime.startedAtMs).toBeGreaterThan(0);
  });

  // ─── RPC handler inventory ─────────────────

  it("has complete set of RPC handlers registered", () => {
    const methods = runtime.rpcDispatcher.listMethods();
    const expected = [
      "mesh.connect",
      "mesh.peers",
      "mesh.status",
      "mesh.message.forward",
      "chat.subscribe",
      "chat.proposal.approve",
      "chat.proposal.reject",
      "context.sync",
      "mesh.health",
      "clawmesh.mock.actuator.state",
    ];
    for (const method of expected) {
      expect(methods).toContain(method);
    }
  });

  // ─── Event bus wired ───────────────────────

  it("event bus receives context.frame.broadcast events", () => {
    let received = false;
    runtime.eventBus.on("context.frame.broadcast", () => {
      received = true;
    });

    runtime.contextPropagator.broadcastObservation({
      data: { metric: "moisture", value: 25, zone: "zone-1" },
    });

    expect(received).toBe(true);
  });

  it("locally broadcast frames are ingested into world model", () => {
    runtime.contextPropagator.broadcastObservation({
      data: { metric: "temperature", value: 30, zone: "zone-1" },
    });

    expect(runtime.worldModel.size).toBe(1);
    const frames = runtime.worldModel.getRecentFrames(10);
    expect(frames[0].data.metric).toBe("temperature");
  });

  // ─── Trust audit wired ─────────────────────

  it("trust audit starts empty before any actuation", () => {
    expect(runtime.trustAudit.size).toBe(0);
  });

  // ─── World model intelligence ──────────────

  it("world model supports relevance-scored queries", () => {
    const now = Date.now();
    runtime.contextPropagator.broadcastObservation({
      data: { metric: "moisture", value: 10, zone: "zone-1" },
    });

    const relevant = runtime.worldModel.getRelevantFrames(5, now);
    expect(relevant.length).toBe(1);
  });

  it("world model supports summarize", () => {
    runtime.contextPropagator.broadcastObservation({
      data: { metric: "moisture", value: 22, zone: "zone-1" },
    });
    runtime.contextPropagator.broadcastObservation({
      data: { metric: "temp", value: 35, zone: "zone-2" },
    });

    const summary = runtime.worldModel.summarize();
    expect(summary).toContain("zone-1");
    expect(summary).toContain("zone-2");
  });

  // ─── Node lifecycle ────────────────────────

  it("start and stop without errors", async () => {
    const addr = await runtime.start();
    expect(addr.port).toBeGreaterThan(0);
    await runtime.stop();
  });

  it("listen address returns correct port after start", async () => {
    const addr = await runtime.start();
    const listen = runtime.listenAddress();
    expect(listen.port).toBe(addr.port);
    await runtime.stop();
  });

  it("advertised capabilities include actuator:mock when enabled", () => {
    const caps = runtime.getAdvertisedCapabilities();
    expect(caps).toContain("actuator:mock");
    expect(caps).toContain("channel:clawmesh");
  });

  // ─── Event bus lifecycle events ────────────

  it("emits runtime.started event on start", async () => {
    let startPayload: { host: string; port: number } | undefined;
    runtime.eventBus.on("runtime.started", (p) => { startPayload = p; });

    const addr = await runtime.start();
    expect(startPayload).toBeDefined();
    expect(startPayload!.port).toBe(addr.port);

    await runtime.stop();
  });

  it("emits runtime.stopping event on stop", async () => {
    let stopEmitted = false;
    runtime.eventBus.on("runtime.stopping", () => { stopEmitted = true; });

    await runtime.start();
    await runtime.stop();
    expect(stopEmitted).toBe(true);
  });
});
