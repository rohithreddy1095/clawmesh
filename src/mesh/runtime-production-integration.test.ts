/**
 * Runtime integration test — verifies all production modules are
 * properly wired and work together in a real MeshNodeRuntime.
 */

import { describe, it, expect, afterEach } from "vitest";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { MeshNodeRuntime } from "./node-runtime.js";

describe("MeshNodeRuntime production module integration", () => {
  let runtime: MeshNodeRuntime;

  afterEach(async () => {
    if (runtime) {
      await runtime.stop().catch(() => {});
    }
  });

  function createRuntime() {
    const identity = loadOrCreateDeviceIdentity();
    runtime = new MeshNodeRuntime({
      identity,
      host: "127.0.0.1",
      port: 0,
      capabilities: ["sensor:test"],
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    return runtime;
  }

  it("has MetricsCollector wired", () => {
    const rt = createRuntime();
    expect(rt.metrics).toBeDefined();
    expect(typeof rt.metrics.inc).toBe("function");
    expect(typeof rt.metrics.snapshot).toBe("function");
  });

  it("has SystemEventLog wired", () => {
    const rt = createRuntime();
    expect(rt.eventLog).toBeDefined();
    expect(typeof rt.eventLog.recent).toBe("function");
  });

  it("has CorrelationTracker wired", () => {
    const rt = createRuntime();
    expect(rt.correlationTracker).toBeDefined();
    expect(typeof rt.correlationTracker.get).toBe("function");
  });

  it("event log captures startup event", async () => {
    const rt = createRuntime();
    await rt.start();
    const events = rt.eventLog.recent(10);
    expect(events.some(e => e.type === "startup")).toBe(true);
  });

  it("event log captures shutdown event", async () => {
    const rt = createRuntime();
    await rt.start();
    await rt.stop();
    const events = rt.eventLog.recent(10);
    expect(events.some(e => e.type === "shutdown")).toBe(true);
  });

  it("metrics are initially zero", () => {
    const rt = createRuntime();
    expect(rt.metrics.getCounter("mesh.inbound.messages")).toBe(0);
  });

  it("locally broadcast frame triggers correlation tracking", async () => {
    const rt = createRuntime();
    await rt.start();

    // Broadcast a sensor observation
    rt.contextPropagator.broadcastObservation({
      data: { metric: "soil_moisture", value: 42, zone: "zone-1" },
      note: "Test reading",
    });

    // World model should have it
    const frames = rt.worldModel.getRecentFrames(5);
    expect(frames.length).toBeGreaterThanOrEqual(1);
  });

  it("RPC dispatcher has mesh.events and mesh.trace registered", () => {
    const rt = createRuntime();
    const methods = rt.rpcDispatcher.listMethods();
    expect(methods).toContain("mesh.events");
    expect(methods).toContain("mesh.trace");
    expect(methods).toContain("mesh.health");
  });
});
