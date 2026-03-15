import { describe, it, expect, beforeEach } from "vitest";
import {
  handleContextSyncRequest,
  ingestSyncResponse,
  calculateSyncSince,
  type ContextSyncRequest,
} from "./context-sync.js";
import { WorldModel } from "./world-model.js";
import type { ContextFrame } from "./context-types.js";

const noop = { info: () => {} };

function makeFrame(overrides?: Partial<ContextFrame>): ContextFrame {
  return {
    kind: "observation",
    frameId: `frame-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "device-abc",
    sourceDisplayName: "test-node",
    timestamp: Date.now(),
    data: { metric: "soil_moisture", value: 25.3, zone: "zone-1" },
    trust: {
      evidence_sources: ["sensor"],
      evidence_trust_tier: "T2_operational_observation",
    },
    ...overrides,
  };
}

describe("handleContextSyncRequest", () => {
  let worldModel: WorldModel;

  beforeEach(() => {
    worldModel = new WorldModel({ log: noop });
  });

  it("returns frames newer than the since timestamp", () => {
    const old = makeFrame({ frameId: "old", timestamp: 1000 });
    const recent = makeFrame({ frameId: "recent", timestamp: 5000 });
    worldModel.ingest(old);
    worldModel.ingest(recent);

    const response = handleContextSyncRequest(worldModel, { since: 2000 });

    expect(response.frames).toHaveLength(1);
    expect(response.frames[0].frameId).toBe("recent");
  });

  it("returns empty array when no frames match", () => {
    const old = makeFrame({ frameId: "old", timestamp: 1000 });
    worldModel.ingest(old);

    const response = handleContextSyncRequest(worldModel, { since: 5000 });

    expect(response.frames).toHaveLength(0);
    expect(response.totalAvailable).toBe(0);
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 10; i++) {
      worldModel.ingest(makeFrame({ frameId: `f-${i}`, timestamp: 100 + i }));
    }

    const response = handleContextSyncRequest(worldModel, { since: 0, limit: 3 });

    expect(response.frames).toHaveLength(3);
    expect(response.totalAvailable).toBe(10);
    // Should return the most recent 3
    expect(response.frames[0].frameId).toBe("f-7");
    expect(response.frames[2].frameId).toBe("f-9");
  });

  it("caps limit at 500 to prevent abuse", () => {
    const response = handleContextSyncRequest(worldModel, { since: 0, limit: 999 });

    // Should not throw and should cap internally
    expect(response.frames).toHaveLength(0);
    expect(response.peerTimestamp).toBeGreaterThan(0);
  });

  it("filters by kind", () => {
    worldModel.ingest(makeFrame({ frameId: "obs", kind: "observation", timestamp: 100 }));
    worldModel.ingest(makeFrame({ frameId: "evt", kind: "event", timestamp: 200 }));
    worldModel.ingest(makeFrame({ frameId: "obs2", kind: "observation", timestamp: 300 }));

    const response = handleContextSyncRequest(worldModel, {
      since: 0,
      kind: "observation",
    });

    expect(response.frames).toHaveLength(2);
    expect(response.frames.every((f) => f.kind === "observation")).toBe(true);
  });

  it("filters by zone", () => {
    worldModel.ingest(
      makeFrame({ frameId: "z1", timestamp: 100, data: { zone: "zone-1", metric: "m", value: 1 } }),
    );
    worldModel.ingest(
      makeFrame({ frameId: "z2", timestamp: 200, data: { zone: "zone-2", metric: "m", value: 2 } }),
    );
    worldModel.ingest(
      makeFrame({ frameId: "z1b", timestamp: 300, data: { zone: "zone-1", metric: "m", value: 3 } }),
    );

    const response = handleContextSyncRequest(worldModel, {
      since: 0,
      zone: "zone-1",
    });

    expect(response.frames).toHaveLength(2);
    expect(response.frames.every((f) => f.data.zone === "zone-1")).toBe(true);
  });

  it("includes peerTimestamp in response", () => {
    const before = Date.now();
    const response = handleContextSyncRequest(worldModel, { since: 0 });
    const after = Date.now();

    expect(response.peerTimestamp).toBeGreaterThanOrEqual(before);
    expect(response.peerTimestamp).toBeLessThanOrEqual(after);
  });

  it("combines kind and zone filters", () => {
    worldModel.ingest(
      makeFrame({ frameId: "match", kind: "observation", timestamp: 100, data: { zone: "zone-1", metric: "m", value: 1 } }),
    );
    worldModel.ingest(
      makeFrame({ frameId: "wrong-zone", kind: "observation", timestamp: 200, data: { zone: "zone-2", metric: "m", value: 2 } }),
    );
    worldModel.ingest(
      makeFrame({ frameId: "wrong-kind", kind: "event", timestamp: 300, data: { zone: "zone-1", metric: "m", value: 3 } }),
    );

    const response = handleContextSyncRequest(worldModel, {
      since: 0,
      kind: "observation",
      zone: "zone-1",
    });

    expect(response.frames).toHaveLength(1);
    expect(response.frames[0].frameId).toBe("match");
  });
});

describe("ingestSyncResponse", () => {
  let worldModel: WorldModel;

  beforeEach(() => {
    worldModel = new WorldModel({ log: noop });
  });

  it("ingests new frames into the world model", () => {
    const frames = [
      makeFrame({ frameId: "f1", timestamp: 100, data: { metric: "soil_moisture", value: 20, zone: "zone-1" } }),
      makeFrame({ frameId: "f2", timestamp: 200, data: { metric: "temperature", value: 35, zone: "zone-2" } }),
    ];

    const result = ingestSyncResponse(worldModel, {
      frames,
      peerTimestamp: Date.now(),
      totalAvailable: 2,
    });

    expect(result.ingested).toBe(2);
    expect(result.duplicates).toBe(0);
    // WorldModel groups by composite key (source+kind+zone+metric), so 2 distinct entries
    expect(worldModel.size).toBe(2);
  });

  it("deduplicates frames already in the world model", () => {
    const existing = makeFrame({ frameId: "existing", timestamp: 100 });
    worldModel.ingest(existing);

    const result = ingestSyncResponse(worldModel, {
      frames: [
        existing, // duplicate
        makeFrame({ frameId: "new-one", timestamp: 200 }),
      ],
      peerTimestamp: Date.now(),
      totalAvailable: 2,
    });

    expect(result.ingested).toBe(1);
    expect(result.duplicates).toBe(1);
  });

  it("handles empty response gracefully", () => {
    const result = ingestSyncResponse(worldModel, {
      frames: [],
      peerTimestamp: Date.now(),
      totalAvailable: 0,
    });

    expect(result.ingested).toBe(0);
    expect(result.duplicates).toBe(0);
  });
});

describe("calculateSyncSince", () => {
  it("returns 24h ago when no last known frame", () => {
    const since = calculateSyncSince(null);
    const expected = Date.now() - 24 * 60 * 60 * 1000;
    // Allow 100ms tolerance
    expect(Math.abs(since - expected)).toBeLessThan(100);
  });

  it("returns 1 minute before last known frame", () => {
    const lastKnown = Date.now() - 5 * 60_000; // 5 min ago
    const since = calculateSyncSince(lastKnown);
    expect(since).toBe(lastKnown - 60_000);
  });

  it("respects custom maxLookbackMs", () => {
    const since = calculateSyncSince(null, 60 * 60 * 1000); // 1 hour
    const expected = Date.now() - 60 * 60 * 1000;
    expect(Math.abs(since - expected)).toBeLessThan(100);
  });

  it("uses lookback even if last frame is very old", () => {
    const veryOld = Date.now() - 48 * 60 * 60 * 1000; // 48h ago
    const since = calculateSyncSince(veryOld);
    // Should be 1 minute before the very old frame
    expect(since).toBe(veryOld - 60_000);
  });
});
