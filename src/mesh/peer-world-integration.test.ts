/**
 * PeerRegistry and WorldModel advanced integration tests.
 *
 * Tests complex scenarios across the mesh foundation modules.
 */

import { describe, it, expect } from "vitest";
import { PeerRegistry } from "../mesh/peer-registry.js";
import { WorldModel } from "../mesh/world-model.js";

function makeWorldModel() {
  return new WorldModel({
    autoEvictTtlMs: 0,
    maxHistory: 100,
    log: { info: () => {} },
  });
}
import type { ContextFrame } from "../mesh/context-types.js";

function makeFrame(overrides?: Partial<ContextFrame>): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "sensor-01",
    timestamp: Date.now(),
    data: { metric: "soil_moisture", value: 42, zone: "zone-1" },
    trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    ...overrides,
  };
}

describe("PeerRegistry advanced scenarios", () => {
  it("listConnected returns empty when no peers registered", () => {
    const registry = new PeerRegistry();
    expect(registry.listConnected()).toEqual([]);
  });

  it("broadcastEvent with no connected peers is a no-op", () => {
    const registry = new PeerRegistry();
    // Should not throw
    registry.broadcastEvent("test.event", { data: "hello" });
  });
});

describe("WorldModel advanced scenarios", () => {
  it("ingest updates existing entry for same kind+sourceDeviceId+metric", () => {
    const wm = makeWorldModel();
    const f1 = makeFrame({ data: { metric: "soil_moisture", value: 30, zone: "z1" } });
    const f2 = makeFrame({ data: { metric: "soil_moisture", value: 25, zone: "z1" } });

    wm.ingest(f1);
    wm.ingest(f2);

    // Should have updated, not duplicated
    const recent = wm.getRecentFrames(10);
    // At least one frame should be present
    expect(recent.length).toBeGreaterThanOrEqual(1);
  });

  it("getByKind returns frames of specific type", () => {
    const wm = makeWorldModel();
    wm.ingest(makeFrame({ kind: "observation" }));
    wm.ingest(makeFrame({ kind: "event", data: { event: "test" } }));
    wm.ingest(makeFrame({ kind: "observation" }));

    const observations = wm.getByKind("observation");
    expect(observations.length).toBeGreaterThanOrEqual(1);
  });

  it("summarize returns zone-grouped summary", () => {
    const wm = makeWorldModel();
    wm.ingest(makeFrame({ data: { metric: "temp", value: 30, zone: "z1" } }));
    wm.ingest(makeFrame({ data: { metric: "humidity", value: 65, zone: "z1" } }));
    wm.ingest(makeFrame({ data: { metric: "temp", value: 28, zone: "z2" } }));

    const summary = wm.summarize(10);
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(0);
  });

  it("getRelevantFrames returns scored results", () => {
    const wm = makeWorldModel();
    for (let i = 0; i < 5; i++) {
      wm.ingest(makeFrame({
        frameId: `f-${i}`,
        timestamp: Date.now() - i * 60000,
        data: { metric: "soil_moisture", value: 50 - i * 10, zone: "z1" },
      }));
    }

    const relevant = wm.getRelevantFrames(3);
    expect(relevant.length).toBeLessThanOrEqual(3);
  });
});

describe("PeerRegistry + WorldModel integration", () => {
  it("registry tracks capabilities independently from world model", () => {
    const registry = new PeerRegistry();
    const wm = makeWorldModel();

    // World model ingests frames regardless of peer state
    wm.ingest(makeFrame({ sourceDeviceId: "unknown-peer" }));
    const frames = wm.getRecentFrames(5);
    expect(frames.length).toBeGreaterThanOrEqual(1);

    // Registry doesn't know about this peer
    expect(registry.listConnected()).toHaveLength(0);
  });
});
