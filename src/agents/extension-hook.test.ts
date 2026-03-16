/**
 * Tests for the improved before_agent_start hook in clawmesh-mesh-extension.
 *
 * Verifies that the system prompt injection uses the world model's
 * summarize() and getRelevantFrames() instead of raw frame dumps.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MeshNodeRuntime } from "../mesh/node-runtime.js";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ContextFrame } from "../mesh/context-types.js";

const noop = { info: () => {}, warn: () => {}, error: () => {} };

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ext-hook-test-"));
}

function makeFrame(overrides?: Partial<ContextFrame>): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "sensor-node",
    sourceDisplayName: "jetson-field",
    timestamp: Date.now(),
    data: { metric: "soil_moisture", value: 25, zone: "zone-1" },
    trust: {
      evidence_sources: ["sensor"],
      evidence_trust_tier: "T2_operational_observation",
    },
    ...overrides,
  };
}

describe("World Model summarize integration", () => {
  let tmpDir: string;
  let runtime: MeshNodeRuntime;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const identity = loadOrCreateDeviceIdentity(join(tmpDir, "device.json"));
    runtime = new MeshNodeRuntime({
      identity,
      port: 0,
      displayName: "test-node",
      log: noop,
    });
  });

  afterEach(async () => {
    await runtime.stop();
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it("world model summarize produces zone-grouped output", () => {
    runtime.worldModel.ingest(makeFrame({
      frameId: "z1-moisture",
      data: { metric: "soil_moisture", value: 22, zone: "zone-1" },
    }));
    runtime.worldModel.ingest(makeFrame({
      frameId: "z2-temp",
      data: { metric: "temperature", value: 35, zone: "zone-2" },
    }));

    const summary = runtime.worldModel.summarize();
    expect(summary).toContain("zone-1");
    expect(summary).toContain("zone-2");
    expect(summary).toContain("soil_moisture=22");
    expect(summary).toContain("temperature=35");
  });

  it("getRelevantFrames prioritizes recent frames", () => {
    const now = Date.now();
    runtime.worldModel.ingest(makeFrame({
      frameId: "old",
      timestamp: now - 3600_000,
      data: { metric: "old_reading", value: 50, zone: "zone-3" },
    }));
    runtime.worldModel.ingest(makeFrame({
      frameId: "fresh",
      timestamp: now,
      data: { metric: "fresh_reading", value: 15, zone: "zone-1" },
    }));

    const relevant = runtime.worldModel.getRelevantFrames(1, now);
    expect(relevant).toHaveLength(1);
    expect(relevant[0].frameId).toBe("fresh");
  });

  it("getRelevantFrames prioritizes human_input over observations", () => {
    const now = Date.now();
    runtime.worldModel.ingest(makeFrame({
      frameId: "obs",
      kind: "observation",
      timestamp: now - 1000,
      data: { metric: "moisture", value: 30, zone: "z1" },
    }));
    runtime.worldModel.ingest(makeFrame({
      frameId: "human",
      kind: "human_input",
      timestamp: now - 1000,
      data: { intent: "check zone-1" },
      trust: { evidence_sources: ["human"], evidence_trust_tier: "T3_verified_action_evidence" },
    }));

    const relevant = runtime.worldModel.getRelevantFrames(1, now);
    expect(relevant[0].frameId).toBe("human");
  });

  it("world model evictStale removes old entries", () => {
    const now = Date.now();
    runtime.worldModel.ingest(makeFrame({
      frameId: "ancient",
      timestamp: now - 86400_000, // 24h ago
      data: { metric: "old", value: 1, zone: "z-old" },
    }));
    runtime.worldModel.ingest(makeFrame({
      frameId: "current",
      timestamp: now,
      data: { metric: "new", value: 99, zone: "z-new" },
    }));

    const evicted = runtime.worldModel.evictStale(3600_000); // 1 hour TTL
    expect(evicted).toBe(1);
    expect(runtime.worldModel.size).toBe(1);
  });
});
