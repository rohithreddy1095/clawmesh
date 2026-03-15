import { describe, it, expect, beforeEach } from "vitest";
import { TriggerQueue, TRIGGER_PRIORITIES } from "./trigger-queue.js";
import type { ContextFrame } from "../mesh/context-types.js";

function makeFrame(overrides?: Partial<ContextFrame>): ContextFrame {
  return {
    kind: "observation",
    frameId: `frame-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "device-abc",
    timestamp: Date.now(),
    data: { metric: "soil_moisture", value: 15, zone: "zone-1" },
    trust: {
      evidence_sources: ["sensor"],
      evidence_trust_tier: "T2_operational_observation",
    },
    ...overrides,
  };
}

describe("TriggerQueue", () => {
  let queue: TriggerQueue;

  beforeEach(() => {
    queue = new TriggerQueue();
  });

  // ─── Basic operations ──────────────────────

  it("starts empty", () => {
    expect(queue.length).toBe(0);
    expect(queue.isEmpty).toBe(true);
  });

  it("enqueues triggers and reports length", () => {
    queue.enqueueIntent("check zone-1");
    expect(queue.length).toBe(1);
    expect(queue.isEmpty).toBe(false);
  });

  it("clear empties the queue", () => {
    queue.enqueueIntent("a");
    queue.enqueueIntent("b");
    queue.clear();
    expect(queue.length).toBe(0);
    expect(queue.isEmpty).toBe(true);
  });

  // ─── Priority ordering ─────────────────────

  it("drains in priority order: intents > thresholds > proactive", () => {
    queue.enqueueProactiveCheck([makeFrame()]);
    queue.enqueueThresholdBreach({
      ruleId: "r1",
      promptHint: "Low moisture",
      metric: "soil_moisture",
      zone: "zone-1",
      frame: makeFrame(),
    });
    queue.enqueueIntent("urgent request");

    const all = queue.drainAll();
    expect(all).toHaveLength(3);
    expect(all[0].type).toBe("operator_intent"); // priority 0
    expect(all[1].type).toBe("threshold_breach"); // priority 1
    expect(all[2].type).toBe("proactive_check");  // priority 3
  });

  it("drain() separates operator intents from system triggers", () => {
    queue.enqueueIntent("hello");
    queue.enqueueThresholdBreach({
      ruleId: "r1",
      promptHint: "dry",
      metric: "moisture",
      frame: makeFrame(),
    });
    queue.enqueueProactiveCheck([]);

    const { operatorIntents, systemTriggers } = queue.drain();
    expect(operatorIntents).toHaveLength(1);
    expect(operatorIntents[0].type).toBe("operator_intent");
    expect(systemTriggers).toHaveLength(2);
  });

  it("drainAll clears the queue", () => {
    queue.enqueueIntent("a");
    queue.enqueueIntent("b");
    queue.drainAll();
    expect(queue.length).toBe(0);
  });

  // ─── Deduplication ─────────────────────────

  it("deduplicates threshold breaches for same metric+zone within window", () => {
    const frame1 = makeFrame({ data: { metric: "moisture", value: 10, zone: "z1" } });
    const frame2 = makeFrame({ data: { metric: "moisture", value: 8, zone: "z1" } });

    const added1 = queue.enqueueThresholdBreach({
      ruleId: "r1",
      promptHint: "dry",
      metric: "moisture",
      zone: "z1",
      frame: frame1,
    });
    const added2 = queue.enqueueThresholdBreach({
      ruleId: "r1",
      promptHint: "dry",
      metric: "moisture",
      zone: "z1",
      frame: frame2,
    });

    expect(added1).toBe(true);
    expect(added2).toBe(false); // Deduplicated
    expect(queue.length).toBe(1);
  });

  it("does NOT deduplicate different metrics", () => {
    queue.enqueueThresholdBreach({
      ruleId: "r1",
      promptHint: "dry",
      metric: "moisture",
      zone: "z1",
      frame: makeFrame(),
    });
    queue.enqueueThresholdBreach({
      ruleId: "r2",
      promptHint: "hot",
      metric: "temperature",
      zone: "z1",
      frame: makeFrame(),
    });

    expect(queue.length).toBe(2);
  });

  it("does NOT deduplicate different zones", () => {
    queue.enqueueThresholdBreach({
      ruleId: "r1",
      promptHint: "dry",
      metric: "moisture",
      zone: "z1",
      frame: makeFrame(),
    });
    queue.enqueueThresholdBreach({
      ruleId: "r1",
      promptHint: "dry",
      metric: "moisture",
      zone: "z2",
      frame: makeFrame(),
    });

    expect(queue.length).toBe(2);
  });

  it("deduplicates proactive checks", () => {
    queue.enqueueProactiveCheck([makeFrame()]);
    queue.enqueueProactiveCheck([makeFrame()]);
    expect(queue.length).toBe(1);
  });

  it("does NOT deduplicate operator intents (no dedupKey)", () => {
    queue.enqueueIntent("first");
    queue.enqueueIntent("second");
    expect(queue.length).toBe(2);
  });

  // ─── Peek ──────────────────────────────────

  it("peek returns highest priority without removing", () => {
    queue.enqueueProactiveCheck([]);
    queue.enqueueIntent("urgent");

    const peeked = queue.peek();
    expect(peeked?.type).toBe("operator_intent");
    expect(queue.length).toBe(2); // Not removed
  });

  it("peek returns undefined when empty", () => {
    expect(queue.peek()).toBeUndefined();
  });

  // ─── Max size ──────────────────────────────

  it("rejects lowest priority when at maxSize", () => {
    const smallQueue = new TriggerQueue({ maxSize: 2 });
    smallQueue.enqueueIntent("keep-1");
    smallQueue.enqueueThresholdBreach({
      ruleId: "r1",
      promptHint: "dry",
      metric: "m",
      frame: makeFrame(),
    });

    // Proactive (priority 3) should be rejected since queue is full with higher-priority items
    const added = smallQueue.enqueueProactiveCheck([]);
    expect(added).toBe(false);
    expect(smallQueue.length).toBe(2);

    const all = smallQueue.drainAll();
    expect(all.some((t) => t.type === "operator_intent")).toBe(true);
    expect(all.some((t) => t.type === "threshold_breach")).toBe(true);
  });

  it("evicts lowest priority existing when higher priority arrives at maxSize", () => {
    const smallQueue = new TriggerQueue({ maxSize: 2 });
    smallQueue.enqueueProactiveCheck([]);
    smallQueue.enqueueThresholdBreach({
      ruleId: "r1",
      promptHint: "dry",
      metric: "m",
      frame: makeFrame(),
    });

    // Intent (priority 0) should evict proactive (priority 3)
    const added = smallQueue.enqueueIntent("urgent");
    expect(added).toBe(true);
    expect(smallQueue.length).toBe(2);

    const all = smallQueue.drainAll();
    expect(all.some((t) => t.type === "operator_intent")).toBe(true);
    expect(all.some((t) => t.type === "threshold_breach")).toBe(true);
    expect(all.some((t) => t.type === "proactive_check")).toBe(false);
  });

  // ─── Convenience methods ───────────────────

  it("enqueueIntent sets correct fields", () => {
    queue.enqueueIntent("irrigate zone-1", {
      conversationId: "conv-1",
      requestId: "req-1",
    });

    const all = queue.drainAll();
    expect(all[0].type).toBe("operator_intent");
    expect(all[0].conversationId).toBe("conv-1");
    expect(all[0].requestId).toBe("req-1");
    expect(all[0].reason).toContain("irrigate zone-1");
  });

  it("enqueueThresholdBreach includes frame", () => {
    const frame = makeFrame();
    queue.enqueueThresholdBreach({
      ruleId: "r1",
      promptHint: "critical moisture",
      metric: "moisture",
      zone: "zone-1",
      frame,
    });

    const all = queue.drainAll();
    expect(all[0].frames).toHaveLength(1);
    expect(all[0].frames[0]).toBe(frame);
    expect(all[0].reason).toContain("r1");
    expect(all[0].reason).toContain("critical moisture");
  });
});

describe("TRIGGER_PRIORITIES", () => {
  it("operator_intent has highest priority (0)", () => {
    expect(TRIGGER_PRIORITIES.operator_intent).toBe(0);
  });

  it("threshold_breach has medium priority (1)", () => {
    expect(TRIGGER_PRIORITIES.threshold_breach).toBe(1);
  });

  it("proactive_check has lowest priority (3)", () => {
    expect(TRIGGER_PRIORITIES.proactive_check).toBe(3);
  });

  it("all priority values are defined", () => {
    expect(Object.keys(TRIGGER_PRIORITIES)).toHaveLength(3);
  });
});
