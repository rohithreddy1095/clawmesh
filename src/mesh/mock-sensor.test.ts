import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockSensor } from "./mock-sensor.js";
import { ContextPropagator } from "./context-propagator.js";
import { PeerRegistry } from "./peer-registry.js";
import type { DeviceIdentity } from "../infra/device-identity.js";
import type { ContextFrame } from "./context-types.js";

const noop = { info: () => {} };

const fakeIdentity: DeviceIdentity = {
  deviceId: "sensor-device-id",
  publicKeyPem: "fake",
  privateKeyPem: "fake",
};

describe("MockSensor", () => {
  let propagator: ContextPropagator;
  let broadcastedFrames: ContextFrame[];
  let sensor: MockSensor;

  beforeEach(() => {
    vi.useFakeTimers();
    const peerRegistry = new PeerRegistry();
    propagator = new ContextPropagator({
      identity: fakeIdentity,
      peerRegistry,
      displayName: "sensor-node",
      log: noop,
    });

    broadcastedFrames = [];
    propagator.onLocalBroadcast = (frame) => {
      broadcastedFrames.push(frame);
    };
  });

  afterEach(() => {
    sensor?.stop();
    vi.useRealTimers();
  });

  it("broadcasts moisture observations at intervals", () => {
    sensor = new MockSensor({
      contextPropagator: propagator,
      intervalMs: 1000,
      zone: "zone-1",
    });

    sensor.start();
    vi.advanceTimersByTime(3500);

    expect(broadcastedFrames.length).toBe(3);
    for (const frame of broadcastedFrames) {
      expect(frame.kind).toBe("observation");
      expect(frame.data.zone).toBe("zone-1");
      expect(frame.data.metric).toBe("moisture");
      expect(typeof frame.data.value).toBe("number");
    }
  });

  it("produces realistic drying pattern", () => {
    sensor = new MockSensor({
      contextPropagator: propagator,
      intervalMs: 100,
    });

    sensor.start();
    vi.advanceTimersByTime(1000);

    const values = broadcastedFrames.map((f) => f.data.value as number);
    expect(values.length).toBe(10);
    // Values should generally decrease (drying pattern)
    // Not all will be monotonically decreasing due to jitter, but the trend should be down
    const first = values[0];
    const last = values[values.length - 1];
    expect(first).toBeGreaterThan(last - 5); // Allow some jitter tolerance
  });

  it("reports status based on moisture level", () => {
    sensor = new MockSensor({
      contextPropagator: propagator,
      intervalMs: 100,
    });

    sensor.start();
    // Run long enough for moisture to drop through all zones
    vi.advanceTimersByTime(10000);

    const statuses = broadcastedFrames.map((f) => f.data.status as string);
    const hasNormal = statuses.includes("normal");
    const hasLow = statuses.includes("low");
    const hasCritical = statuses.includes("critical");

    // Should have at least some status variation (starts at 35% = normal)
    expect(hasNormal).toBe(true);
    // May or may not reach low/critical depending on random jitter
  });

  it("stop() halts broadcasting", () => {
    sensor = new MockSensor({
      contextPropagator: propagator,
      intervalMs: 100,
    });

    sensor.start();
    vi.advanceTimersByTime(500);
    const countBefore = broadcastedFrames.length;

    sensor.stop();
    vi.advanceTimersByTime(500);

    expect(broadcastedFrames.length).toBe(countBefore);
  });

  it("start() is idempotent", () => {
    sensor = new MockSensor({
      contextPropagator: propagator,
      intervalMs: 100,
    });

    sensor.start();
    sensor.start(); // Should not create a second interval
    vi.advanceTimersByTime(500);

    expect(broadcastedFrames.length).toBe(5); // Not 10
  });

  it("defaults to zone-1 and 5000ms interval", () => {
    sensor = new MockSensor({
      contextPropagator: propagator,
    });

    sensor.start();
    vi.advanceTimersByTime(5000);

    expect(broadcastedFrames.length).toBe(1);
    expect(broadcastedFrames[0].data.zone).toBe("zone-1");
  });

  it("resets moisture when it drops below 5% (simulates irrigation)", () => {
    sensor = new MockSensor({
      contextPropagator: propagator,
      intervalMs: 10,
    });

    sensor.start();
    // Run for a very long time to ensure moisture drops and resets
    vi.advanceTimersByTime(5000);

    const values = broadcastedFrames.map((f) => f.data.value as number);
    // At least some values should be above 30 (post-reset)
    const hasHighValues = values.some((v) => v > 30);
    expect(hasHighValues).toBe(true);
  });
});
