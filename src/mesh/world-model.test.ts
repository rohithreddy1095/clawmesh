import { describe, it, expect, beforeEach } from "vitest";
import { WorldModel, scoreFrameRelevance } from "./world-model.js";
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

// ─── scoreFrameRelevance ─────────────────────────

describe("scoreFrameRelevance", () => {
  const now = Date.now();

  it("scores human_input higher than observation", () => {
    const human = makeFrame({ kind: "human_input", timestamp: now });
    const obs = makeFrame({ kind: "observation", timestamp: now });
    expect(scoreFrameRelevance(human, now)).toBeGreaterThan(scoreFrameRelevance(obs, now));
  });

  it("scores events higher than observations", () => {
    const event = makeFrame({ kind: "event", timestamp: now });
    const obs = makeFrame({ kind: "observation", timestamp: now });
    expect(scoreFrameRelevance(event, now)).toBeGreaterThan(scoreFrameRelevance(obs, now));
  });

  it("scores recent frames higher than old frames", () => {
    const recent = makeFrame({ timestamp: now });
    const old = makeFrame({ timestamp: now - 2 * 60 * 60 * 1000 }); // 2 hours ago
    expect(scoreFrameRelevance(recent, now)).toBeGreaterThan(scoreFrameRelevance(old, now));
  });

  it("boosts frames with critical keywords", () => {
    const critical = makeFrame({
      timestamp: now,
      data: { metric: "status", value: "critical", zone: "zone-1" },
    });
    const normal = makeFrame({
      timestamp: now,
      data: { metric: "status", value: "normal", zone: "zone-1" },
    });
    expect(scoreFrameRelevance(critical, now)).toBeGreaterThan(
      scoreFrameRelevance(normal, now),
    );
  });

  it("boosts higher trust tiers", () => {
    const t3 = makeFrame({
      timestamp: now,
      trust: { evidence_sources: ["human"], evidence_trust_tier: "T3_verified_action_evidence" },
    });
    const t0 = makeFrame({
      timestamp: now,
      trust: { evidence_sources: ["llm"], evidence_trust_tier: "T0_planning_inference" },
    });
    expect(scoreFrameRelevance(t3, now)).toBeGreaterThan(scoreFrameRelevance(t0, now));
  });

  it("returns a positive number", () => {
    const frame = makeFrame({ timestamp: now });
    expect(scoreFrameRelevance(frame, now)).toBeGreaterThan(0);
  });
});

// ─── WorldModel (existing behavior) ──────────────

describe("WorldModel", () => {
  let model: WorldModel;

  beforeEach(() => {
    model = new WorldModel({ log: noop });
  });

  it("ingests new frames and returns true", () => {
    const frame = makeFrame();
    expect(model.ingest(frame)).toBe(true);
    expect(model.size).toBe(1);
  });

  it("deduplicates by frameId", () => {
    const frame = makeFrame({ frameId: "dup-1" });
    expect(model.ingest(frame)).toBe(true);
    expect(model.ingest(frame)).toBe(false);
    expect(model.size).toBe(1);
  });

  it("getRecentFrames returns in chronological order", () => {
    const f1 = makeFrame({ frameId: "f1", timestamp: 100, data: { metric: "a", value: 1, zone: "z1" } });
    const f2 = makeFrame({ frameId: "f2", timestamp: 200, data: { metric: "b", value: 2, zone: "z2" } });
    model.ingest(f1);
    model.ingest(f2);
    const recent = model.getRecentFrames(10);
    expect(recent[0].frameId).toBe("f1");
    expect(recent[1].frameId).toBe("f2");
  });

  it("getByKind filters correctly", () => {
    model.ingest(makeFrame({ frameId: "obs", kind: "observation" }));
    model.ingest(makeFrame({ frameId: "evt", kind: "event", data: { event: "pump_started" } }));
    const observations = model.getByKind("observation");
    expect(observations).toHaveLength(1);
    expect(observations[0].lastFrame.kind).toBe("observation");
  });

  it("fires onIngest callback", () => {
    let called = false;
    model.onIngest = () => { called = true; };
    model.ingest(makeFrame());
    expect(called).toBe(true);
  });
});

// ─── WorldModel.getRelevantFrames ────────────────

describe("WorldModel.getRelevantFrames", () => {
  let model: WorldModel;

  beforeEach(() => {
    model = new WorldModel({ log: noop });
  });

  it("returns frames sorted by relevance (most relevant first)", () => {
    const now = Date.now();
    // Old observation (low relevance)
    model.ingest(makeFrame({
      frameId: "old-obs",
      kind: "observation",
      timestamp: now - 3600_000, // 1 hour ago
      data: { metric: "temp", value: 30, zone: "z1" },
    }));
    // Recent human input (high relevance)
    model.ingest(makeFrame({
      frameId: "human",
      kind: "human_input",
      timestamp: now - 1000,
      data: { intent: "check zone-1" },
      trust: { evidence_sources: ["human"], evidence_trust_tier: "T3_verified_action_evidence" },
    }));
    // Recent observation (medium relevance)
    model.ingest(makeFrame({
      frameId: "recent-obs",
      kind: "observation",
      timestamp: now - 5000,
      data: { metric: "moisture", value: 15, zone: "z2" },
    }));

    const relevant = model.getRelevantFrames(3, now);
    expect(relevant[0].frameId).toBe("human"); // highest: human_input + recent + T3
  });

  it("respects limit parameter", () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      model.ingest(makeFrame({
        frameId: `f-${i}`,
        timestamp: now - i * 1000,
        data: { metric: `m${i}`, value: i, zone: `z${i}` },
      }));
    }
    const relevant = model.getRelevantFrames(3, now);
    expect(relevant).toHaveLength(3);
  });

  it("returns empty array when no frames", () => {
    expect(model.getRelevantFrames(5)).toEqual([]);
  });
});

// ─── WorldModel.evictStale ───────────────────────

describe("WorldModel.evictStale", () => {
  let model: WorldModel;

  beforeEach(() => {
    model = new WorldModel({ log: noop });
  });

  it("removes entries older than TTL", () => {
    const now = Date.now();
    model.ingest(makeFrame({
      frameId: "old",
      timestamp: now - 7200_000, // 2 hours ago
      data: { metric: "temp", value: 30, zone: "z1" },
    }));
    model.ingest(makeFrame({
      frameId: "recent",
      timestamp: now - 1000,
      data: { metric: "moisture", value: 50, zone: "z2" },
    }));

    const evicted = model.evictStale(3600_000); // 1 hour TTL
    expect(evicted).toBe(1);
    expect(model.size).toBe(1);
  });

  it("returns 0 when nothing is stale", () => {
    model.ingest(makeFrame({ frameId: "fresh", timestamp: Date.now() }));
    expect(model.evictStale(3600_000)).toBe(0);
  });

  it("cleans frame log when evicting", () => {
    const now = Date.now();
    model.ingest(makeFrame({ frameId: "old1", timestamp: now - 5000, data: { metric: "a", value: 1, zone: "z1" } }));
    model.ingest(makeFrame({ frameId: "old2", timestamp: now - 4000, data: { metric: "b", value: 2, zone: "z2" } }));
    model.ingest(makeFrame({ frameId: "new1", timestamp: now, data: { metric: "c", value: 3, zone: "z3" } }));

    model.evictStale(3000); // 3 second TTL
    const remaining = model.getRecentFrames(100);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].frameId).toBe("new1");
  });
});

// ─── WorldModel.summarize ────────────────────────

describe("WorldModel.summarize", () => {
  let model: WorldModel;

  beforeEach(() => {
    model = new WorldModel({ log: noop });
  });

  it("produces a summary string", () => {
    model.ingest(makeFrame({
      frameId: "f1",
      timestamp: Date.now(),
      data: { metric: "soil_moisture", value: 25.3, zone: "zone-1" },
    }));
    const summary = model.summarize();
    expect(summary).toContain("World Model:");
    expect(summary).toContain("zone-1");
    expect(summary).toContain("soil_moisture=25.3");
  });

  it("groups by zone", () => {
    const now = Date.now();
    model.ingest(makeFrame({
      frameId: "z1-m",
      timestamp: now,
      data: { metric: "moisture", value: 30, zone: "zone-1" },
    }));
    model.ingest(makeFrame({
      frameId: "z2-m",
      timestamp: now,
      data: { metric: "moisture", value: 45, zone: "zone-2" },
    }));
    const summary = model.summarize();
    expect(summary).toContain("zone-1");
    expect(summary).toContain("zone-2");
  });

  it("handles empty world model", () => {
    const summary = model.summarize();
    expect(summary).toContain("0 entries");
    expect(summary).toContain("0 frames");
  });

  it("includes recent events", () => {
    model.ingest(makeFrame({
      frameId: "evt",
      kind: "event",
      timestamp: Date.now(),
      data: { event: "pump_started", target: "P1" },
      note: "Pump P1 started by operator",
    }));
    const summary = model.summarize();
    expect(summary).toContain("Recent events");
    expect(summary).toContain("Pump P1 started");
  });
});

// ─── WorldModel auto-eviction ────────────────────

describe("WorldModel auto-eviction", () => {
  it("creates model with auto-eviction disabled by default", () => {
    const model = new WorldModel({ log: noop });
    // No timer should be set
    model.stopAutoEviction(); // Should not throw
  });

  it("creates model with auto-eviction enabled", () => {
    const model = new WorldModel({
      log: noop,
      autoEvictTtlMs: 60_000,
      autoEvictIntervalMs: 1000,
    });

    // Cleanup timer
    model.stopAutoEviction();
  });

  it("stopAutoEviction is idempotent", () => {
    const model = new WorldModel({
      log: noop,
      autoEvictTtlMs: 60_000,
    });

    model.stopAutoEviction();
    model.stopAutoEviction(); // Should not throw
  });

  it("auto-eviction timer fires and cleans stale entries", async () => {
    const model = new WorldModel({
      log: noop,
      autoEvictTtlMs: 100, // 100ms TTL
      autoEvictIntervalMs: 50, // Check every 50ms
    });

    // Add an already-stale frame
    model.ingest(makeFrame({
      frameId: "stale",
      timestamp: Date.now() - 200, // 200ms ago, beyond 100ms TTL
      data: { metric: "old", value: 1, zone: "z-old" },
    }));

    expect(model.size).toBe(1);

    // Wait for eviction timer to fire
    await new Promise((r) => setTimeout(r, 120));

    expect(model.size).toBe(0);

    model.stopAutoEviction();
  });
});
