import { describe, it, expect, beforeEach } from "vitest";
import {
  PatternMemory,
  mergeSourceCounters,
  aggregateSourceCounters,
  type SourceCounters,
  type LearnedPattern,
} from "./pattern-memory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const noop = { info: () => {} };

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "pattern-memory-test-"));
}

function makeAction() {
  return {
    operation: "start",
    targetRef: "actuator:pump:P1",
    summary: "Start pump P1",
  };
}

// ─── CRDT Helpers ──────────────────────────────────

describe("mergeSourceCounters", () => {
  it("merges disjoint sources", () => {
    const local: SourceCounters = { "node-A": { approvals: 3, rejections: 0 } };
    const remote: SourceCounters = { "node-B": { approvals: 0, rejections: 2 } };

    const merged = mergeSourceCounters(local, remote);
    expect(merged).toEqual({
      "node-A": { approvals: 3, rejections: 0 },
      "node-B": { approvals: 0, rejections: 2 },
    });
  });

  it("takes max for overlapping sources", () => {
    const local: SourceCounters = { "node-A": { approvals: 3, rejections: 1 } };
    const remote: SourceCounters = { "node-A": { approvals: 2, rejections: 4 } };

    const merged = mergeSourceCounters(local, remote);
    expect(merged).toEqual({
      "node-A": { approvals: 3, rejections: 4 },
    });
  });

  it("handles empty local", () => {
    const merged = mergeSourceCounters({}, { "node-B": { approvals: 5, rejections: 1 } });
    expect(merged["node-B"]).toEqual({ approvals: 5, rejections: 1 });
  });

  it("handles empty remote", () => {
    const merged = mergeSourceCounters({ "node-A": { approvals: 2, rejections: 0 } }, {});
    expect(merged["node-A"]).toEqual({ approvals: 2, rejections: 0 });
  });
});

describe("aggregateSourceCounters", () => {
  it("sums all sources", () => {
    const counters: SourceCounters = {
      "node-A": { approvals: 3, rejections: 0 },
      "node-B": { approvals: 0, rejections: 2 },
      "node-C": { approvals: 1, rejections: 1 },
    };
    const result = aggregateSourceCounters(counters);
    expect(result).toEqual({ approvals: 4, rejections: 3 });
  });

  it("returns zeros for empty counters", () => {
    expect(aggregateSourceCounters({})).toEqual({ approvals: 0, rejections: 0 });
  });
});

// ─── PatternMemory ─────────────────────────────────

describe("PatternMemory", () => {
  let tmpDir: string;
  let memory: PatternMemory;

  beforeEach(() => {
    tmpDir = makeTempDir();
    memory = new PatternMemory({
      persistPath: join(tmpDir, "patterns.json"),
      localDeviceId: "node-A",
      log: noop,
    });
  });

  // ─── recordDecision ──────────────────────

  it("creates a new pattern on first decision", () => {
    const pattern = memory.recordDecision({
      approved: true,
      triggerCondition: "soil_moisture < 25",
      action: makeAction(),
    });

    expect(pattern.approvalCount).toBe(1);
    expect(pattern.rejectionCount).toBe(0);
    expect(pattern.confidence).toBe(1);
  });

  it("tracks per-source counters for local decisions", () => {
    memory.recordDecision({
      approved: true,
      triggerCondition: "moisture low",
      action: makeAction(),
    });
    memory.recordDecision({
      approved: true,
      triggerCondition: "moisture low",
      action: makeAction(),
    });
    memory.recordDecision({
      approved: false,
      triggerCondition: "moisture low",
      action: makeAction(),
    });

    const patterns = memory.getAllPatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0].sourceCounters?.["node-A"]).toEqual({
      approvals: 2,
      rejections: 1,
    });
    expect(patterns[0].approvalCount).toBe(2);
    expect(patterns[0].rejectionCount).toBe(1);
  });

  it("computes confidence correctly", () => {
    memory.recordDecision({
      approved: true,
      triggerCondition: "test",
      action: makeAction(),
    });
    memory.recordDecision({
      approved: false,
      triggerCondition: "test",
      action: makeAction(),
    });

    const patterns = memory.getAllPatterns();
    expect(patterns[0].confidence).toBe(0.5);
  });

  it("tracks distinct trigger events", () => {
    memory.recordDecision({
      approved: true,
      triggerCondition: "test",
      action: makeAction(),
      triggerEventId: "event-1",
    });
    memory.recordDecision({
      approved: true,
      triggerCondition: "test",
      action: makeAction(),
      triggerEventId: "event-2",
    });

    const patterns = memory.getAllPatterns();
    expect(patterns[0].distinctTriggerEvents).toContain("event-1");
    expect(patterns[0].distinctTriggerEvents).toContain("event-2");
  });

  // ─── CRDT Import/Merge ──────────────────

  it("imports new patterns from remote", () => {
    const remote: LearnedPattern = {
      patternId: "test|start|actuator:pump:p1",
      triggerCondition: "test",
      action: makeAction(),
      approvalCount: 5,
      rejectionCount: 1,
      sourceCounters: {
        "node-B": { approvals: 5, rejections: 1 },
      },
      distinctTriggerEvents: ["e1", "e2"],
      confidence: 5 / 6,
      firstSeenAt: 1000,
      lastUpdatedAt: 2000,
    };

    const imported = memory.importPatterns([remote], "node-B");
    expect(imported).toBe(1);

    const patterns = memory.getAllPatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0].sourceCounters?.["node-B"]).toEqual({
      approvals: 5,
      rejections: 1,
    });
  });

  it("CRDT merges concurrent decisions correctly", () => {
    // Local node-A approves 3 times
    for (let i = 0; i < 3; i++) {
      memory.recordDecision({
        approved: true,
        triggerCondition: "moisture low",
        action: makeAction(),
      });
    }

    // Remote node-B rejected 2 times (concurrent, independent decisions)
    const remotePattern: LearnedPattern = {
      patternId: memory.getAllPatterns()[0].patternId,
      triggerCondition: "moisture low",
      action: makeAction(),
      approvalCount: 0,
      rejectionCount: 2,
      sourceCounters: {
        "node-B": { approvals: 0, rejections: 2 },
      },
      distinctTriggerEvents: [],
      confidence: 0,
      firstSeenAt: 1000,
      lastUpdatedAt: Date.now(),
    };

    memory.importPatterns([remotePattern], "node-B");

    // After CRDT merge: node-A(3 approvals) + node-B(2 rejections) = 3 approvals, 2 rejections
    const merged = memory.getAllPatterns()[0];
    expect(merged.approvalCount).toBe(3);
    expect(merged.rejectionCount).toBe(2);
    expect(merged.confidence).toBeCloseTo(3 / 5);
    expect(merged.sourceCounters?.["node-A"]).toEqual({ approvals: 3, rejections: 0 });
    expect(merged.sourceCounters?.["node-B"]).toEqual({ approvals: 0, rejections: 2 });
  });

  it("CRDT merge takes max per-source on overlap", () => {
    // Local has: node-A: 2 approvals
    memory.recordDecision({ approved: true, triggerCondition: "test", action: makeAction() });
    memory.recordDecision({ approved: true, triggerCondition: "test", action: makeAction() });

    // Remote also has node-A decisions (from an earlier sync) + node-B
    const patternId = memory.getAllPatterns()[0].patternId;
    const remotePattern: LearnedPattern = {
      patternId,
      triggerCondition: "test",
      action: makeAction(),
      approvalCount: 4,
      rejectionCount: 1,
      sourceCounters: {
        "node-A": { approvals: 1, rejections: 0 }, // Older, smaller than local
        "node-B": { approvals: 3, rejections: 1 },
      },
      distinctTriggerEvents: [],
      confidence: 0.8,
      firstSeenAt: 1000,
      lastUpdatedAt: Date.now(),
    };

    memory.importPatterns([remotePattern], "node-B");

    const merged = memory.getAllPatterns()[0];
    // node-A: max(2, 1) = 2 approvals, max(0, 0) = 0 rejections
    // node-B: max(0, 3) = 3 approvals, max(0, 1) = 1 rejection
    // Total: 5 approvals, 1 rejection
    expect(merged.sourceCounters?.["node-A"]).toEqual({ approvals: 2, rejections: 0 });
    expect(merged.sourceCounters?.["node-B"]).toEqual({ approvals: 3, rejections: 1 });
    expect(merged.approvalCount).toBe(5);
    expect(merged.rejectionCount).toBe(1);
  });

  // ─── getMatchingPatterns ─────────────────

  it("finds patterns by metric", () => {
    memory.recordDecision({
      approved: true,
      triggerCondition: "moisture low in zone-1",
      metric: "soil_moisture",
      zone: "zone-1",
      action: makeAction(),
    });
    memory.recordDecision({
      approved: true,
      triggerCondition: "temp high",
      metric: "temperature",
      action: { ...makeAction(), operation: "alert" },
    });

    const matches = memory.getMatchingPatterns({ metric: "soil_moisture" });
    expect(matches).toHaveLength(1);
    expect(matches[0].metric).toBe("soil_moisture");
  });

  // ─── exportPatterns ──────────────────────

  it("only exports patterns meeting gossip threshold", () => {
    // Pattern with enough approvals and events
    for (let i = 0; i < 3; i++) {
      memory.recordDecision({
        approved: true,
        triggerCondition: "mature pattern",
        action: makeAction(),
        triggerEventId: `evt-${i}`,
      });
    }

    // Pattern without enough
    memory.recordDecision({
      approved: true,
      triggerCondition: "immature",
      action: { ...makeAction(), operation: "read" },
    });

    const exportable = memory.exportPatterns();
    expect(exportable).toHaveLength(1);
    expect(exportable[0].triggerCondition).toBe("mature pattern");
  });

  // ─── Persistence ─────────────────────────

  it("persists and loads patterns", () => {
    const persistPath = join(tmpDir, "persist-test.json");
    const mem1 = new PatternMemory({ persistPath, localDeviceId: "A", log: noop });

    mem1.recordDecision({
      approved: true,
      triggerCondition: "persist test",
      action: makeAction(),
    });

    // Create new instance — should load from disk
    const mem2 = new PatternMemory({ persistPath, localDeviceId: "A", log: noop });
    const patterns = mem2.getAllPatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0].triggerCondition).toBe("persist test");
  });
});
