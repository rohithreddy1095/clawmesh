/**
 * Tests for WorldModel snapshot — persistence for fast restart.
 */

import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import {
  createSnapshot,
  saveSnapshot,
  loadSnapshot,
  filterSnapshotByAge,
  isValidSnapshot,
  type WorldModelSnapshotData,
} from "./world-model-snapshot.js";
import type { ContextFrame } from "./context-types.js";

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

describe("createSnapshot", () => {
  it("creates snapshot from frames", () => {
    const frames = [makeFrame(), makeFrame()];
    const snap = createSnapshot(frames, "node-01");
    expect(snap.version).toBe(1);
    expect(snap.nodeId).toBe("node-01");
    expect(snap.frames).toHaveLength(2);
    expect(snap.timestamp).toBeGreaterThan(0);
  });

  it("limits frame count to maxFrames", () => {
    const frames = Array.from({ length: 200 }, () => makeFrame());
    const snap = createSnapshot(frames, "node-01", 50);
    expect(snap.frames).toHaveLength(50);
  });

  it("keeps most recent frames", () => {
    const old = makeFrame({ timestamp: 1000 });
    const recent = makeFrame({ timestamp: 9999 });
    const snap = createSnapshot([old, recent], "node-01", 1);
    expect(snap.frames[0].timestamp).toBe(9999);
  });

  it("handles empty frames", () => {
    const snap = createSnapshot([], "node-01");
    expect(snap.frames).toHaveLength(0);
  });
});

describe("saveSnapshot + loadSnapshot round-trip", () => {
  const path = join(tmpdir(), `clawmesh-test-snapshot-${Date.now()}.json`);

  it("saves and loads correctly", () => {
    const frames = [makeFrame(), makeFrame()];
    const snap = createSnapshot(frames, "node-01");

    expect(saveSnapshot(path, snap)).toBe(true);
    expect(existsSync(path)).toBe(true);

    const loaded = loadSnapshot(path);
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.nodeId).toBe("node-01");
    expect(loaded!.frames).toHaveLength(2);

    // Cleanup
    try { unlinkSync(path); } catch {}
  });

  it("loadSnapshot returns null for missing file", () => {
    expect(loadSnapshot("/nonexistent/path.json")).toBeNull();
  });

  it("loadSnapshot returns null for invalid JSON", () => {
    const badPath = join(tmpdir(), `clawmesh-bad-${Date.now()}.json`);
    require("node:fs").writeFileSync(badPath, "not json");
    expect(loadSnapshot(badPath)).toBeNull();
    try { unlinkSync(badPath); } catch {}
  });

  it("loadSnapshot returns null for wrong version", () => {
    const badPath = join(tmpdir(), `clawmesh-v2-${Date.now()}.json`);
    require("node:fs").writeFileSync(badPath, JSON.stringify({ version: 2, frames: [] }));
    expect(loadSnapshot(badPath)).toBeNull();
    try { unlinkSync(badPath); } catch {}
  });
});

describe("filterSnapshotByAge", () => {
  it("filters out old frames", () => {
    const now = Date.now();
    const snap: WorldModelSnapshotData = {
      version: 1,
      timestamp: now,
      nodeId: "n1",
      frames: [
        makeFrame({ timestamp: now - 1000 }),      // 1s ago — keep
        makeFrame({ timestamp: now - 300_000 }),    // 5min ago — keep
        makeFrame({ timestamp: now - 7_200_000 }),  // 2hrs ago — discard
      ],
    };

    const filtered = filterSnapshotByAge(snap, 3_600_000, now); // 1hr window
    expect(filtered).toHaveLength(2);
  });

  it("returns all frames if all within window", () => {
    const now = Date.now();
    const snap: WorldModelSnapshotData = {
      version: 1,
      timestamp: now,
      nodeId: "n1",
      frames: [makeFrame({ timestamp: now - 100 })],
    };
    expect(filterSnapshotByAge(snap, 60_000, now)).toHaveLength(1);
  });

  it("returns empty for very old snapshot", () => {
    const now = Date.now();
    const snap: WorldModelSnapshotData = {
      version: 1,
      timestamp: now - 86_400_000, // 1 day old
      nodeId: "n1",
      frames: [makeFrame({ timestamp: now - 86_400_000 })],
    };
    expect(filterSnapshotByAge(snap, 3_600_000, now)).toHaveLength(0);
  });
});

describe("isValidSnapshot", () => {
  it("accepts valid snapshot", () => {
    expect(isValidSnapshot({ version: 1, timestamp: 123, nodeId: "n1", frames: [] })).toBe(true);
  });

  it("rejects null", () => {
    expect(isValidSnapshot(null)).toBe(false);
  });

  it("rejects wrong version", () => {
    expect(isValidSnapshot({ version: 2, timestamp: 123, nodeId: "n1", frames: [] })).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(isValidSnapshot({ version: 1 })).toBe(false);
  });

  it("rejects non-array frames", () => {
    expect(isValidSnapshot({ version: 1, timestamp: 123, nodeId: "n1", frames: "not array" })).toBe(false);
  });
});
