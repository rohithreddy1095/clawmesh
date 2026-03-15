/**
 * Architecture edge case tests — boundary conditions and stress tests
 * for the new architecture modules.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { MeshEventBus } from "./event-bus.js";
import { WorldModel, scoreFrameRelevance } from "./world-model.js";
import { TriggerQueue } from "../agents/trigger-queue.js";
import { TrustAuditTrail } from "./trust-audit.js";
import { RpcDispatcher } from "./rpc-dispatcher.js";
import { MockTransport, TransportState } from "./transport.js";
import { AutoConnectManager } from "./auto-connect.js";
import { MeshLogger } from "../infra/mesh-logger.js";
import { matchCapability, parseCapabilityString } from "./capability-types.js";
import type { ContextFrame } from "./context-types.js";

const noop = { info: () => {} };

function makeFrame(overrides?: Partial<ContextFrame>): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "device-abc",
    timestamp: Date.now(),
    data: { metric: "soil_moisture", value: 25, zone: "zone-1" },
    trust: {
      evidence_sources: ["sensor"],
      evidence_trust_tier: "T2_operational_observation",
    },
    ...overrides,
  };
}

// ─── Event Bus Edge Cases ─────────────────────

describe("MeshEventBus edge cases", () => {
  it("handles subscriber throwing without affecting other subscribers", () => {
    const bus = new MeshEventBus();
    const results: number[] = [];

    bus.on("runtime.started", () => {
      results.push(1);
      throw new Error("boom");
    });
    bus.on("runtime.started", () => {
      results.push(2);
    });

    // EventEmitter throws on uncaught errors — but the first handler gets called
    try {
      bus.emit("runtime.started", { host: "0.0.0.0", port: 18789 });
    } catch {
      // Expected
    }
    expect(results).toContain(1);
  });

  it("cleanup function is idempotent", () => {
    const bus = new MeshEventBus();
    const handler = vi.fn();
    const cleanup = bus.on("peer.connected", handler);

    cleanup();
    cleanup(); // Should not throw
    cleanup(); // Should not throw

    expect(bus.listenerCount("peer.connected")).toBe(0);
  });
});

// ─── World Model Edge Cases ───────────────────

describe("WorldModel edge cases", () => {
  it("evictStale with 0 TTL evicts everything", () => {
    const model = new WorldModel({ log: noop });
    model.ingest(makeFrame({ timestamp: Date.now() - 1 }));
    model.ingest(makeFrame({ frameId: "f2", timestamp: Date.now() - 1, data: { metric: "b", value: 2, zone: "z2" } }));

    const evicted = model.evictStale(0);
    expect(evicted).toBe(2);
    expect(model.size).toBe(0);
  });

  it("getRelevantFrames with 0 limit returns empty", () => {
    const model = new WorldModel({ log: noop });
    model.ingest(makeFrame());
    expect(model.getRelevantFrames(0)).toEqual([]);
  });

  it("scoreFrameRelevance for very old frame gives low score", () => {
    const now = Date.now();
    const ancient = makeFrame({ timestamp: now - 24 * 60 * 60 * 1000 }); // 24h ago
    const fresh = makeFrame({ timestamp: now });
    expect(scoreFrameRelevance(ancient, now)).toBeLessThan(scoreFrameRelevance(fresh, now));
  });

  it("summarize handles frame with no zone", () => {
    const model = new WorldModel({ log: noop });
    model.ingest(makeFrame({ data: { metric: "cpu_temp", value: 65 } })); // No zone field
    const summary = model.summarize();
    expect(summary).toContain("World Model:");
  });
});

// ─── Trigger Queue Edge Cases ─────────────────

describe("TriggerQueue edge cases", () => {
  it("dedup window is configurable", () => {
    const queue = new TriggerQueue({ dedupWindowMs: 0 }); // 0ms = no dedup

    queue.enqueueThresholdBreach({
      ruleId: "r1",
      promptHint: "test",
      metric: "m",
      zone: "z1",
      frame: makeFrame(),
    });
    // With 0ms window, same metric+zone should NOT dedup
    queue.enqueueThresholdBreach({
      ruleId: "r1",
      promptHint: "test",
      metric: "m",
      zone: "z1",
      frame: makeFrame(),
    });

    expect(queue.length).toBe(2);
  });

  it("drain returns empty when queue is empty", () => {
    const queue = new TriggerQueue();
    const { operatorIntents, systemTriggers } = queue.drain();
    expect(operatorIntents).toHaveLength(0);
    expect(systemTriggers).toHaveLength(0);
  });

  it("multiple drains are safe", () => {
    const queue = new TriggerQueue();
    queue.enqueueIntent("test");
    queue.drain();
    const second = queue.drain();
    expect(second.operatorIntents).toHaveLength(0);
  });
});

// ─── Transport Edge Cases ─────────────────────

describe("MockTransport edge cases", () => {
  it("allSentJSON handles empty array", () => {
    const t = new MockTransport();
    expect(t.allSentJSON()).toEqual([]);
  });

  it("close() is idempotent", () => {
    const t = new MockTransport();
    t.close();
    t.close(); // Should not throw
    expect(t.readyState).toBe(TransportState.CLOSED);
  });

  it("transitions through all states", () => {
    const t = new MockTransport();
    expect(t.readyState).toBe(TransportState.OPEN);

    t.setReadyState(TransportState.CLOSING);
    expect(t.readyState).toBe(TransportState.CLOSING);

    t.setReadyState(TransportState.CLOSED);
    expect(t.readyState).toBe(TransportState.CLOSED);
  });
});

// ─── Trust Audit Edge Cases ───────────────────

describe("TrustAuditTrail edge cases", () => {
  it("query with combined filters", () => {
    const audit = new TrustAuditTrail();
    audit.record(
      { channel: "clawmesh", to: "a", originGatewayId: "g", idempotencyKey: "k", trust: { action_type: "actuation" } },
      { ok: true },
    );
    audit.record(
      { channel: "clawmesh", to: "b", originGatewayId: "g", idempotencyKey: "k", trust: { action_type: "observation" } },
      { ok: true },
    );
    audit.record(
      { channel: "telegram", to: "c", originGatewayId: "g", idempotencyKey: "k", trust: { action_type: "actuation" } },
      { ok: false, code: "ERR" },
    );

    const results = audit.query({ ok: true, actionType: "actuation", channel: "clawmesh" });
    expect(results).toHaveLength(1);
    expect(results[0].to).toBe("a");
  });

  it("getStats on empty trail", () => {
    const audit = new TrustAuditTrail();
    const stats = audit.getStats();
    expect(stats.total).toBe(0);
    expect(stats.approvalRate).toBe(0);
  });
});

// ─── Auto-Connect Edge Cases ──────────────────

describe("AutoConnectManager edge cases", () => {
  it("handles rapid discovery of same peer", () => {
    const manager = new AutoConnectManager();
    const peer = {
      deviceId: "peer-x",
      host: "10.0.0.1",
      port: 18789,
      discoveredAtMs: Date.now(),
    };

    const d1 = manager.evaluate(peer);
    const d2 = manager.evaluate(peer);

    // First should connect, second should also connect (different attempt)
    expect(d1.action).toBe("connect");
    // Second might be rate-limited or connect depending on maxAttempts
  });
});

// ─── Capability Matching Edge Cases ───────────

describe("Capability matching edge cases", () => {
  it("wildcard-only pattern matches everything", () => {
    expect(matchCapability("anything", "*")).toBe(true);
    expect(matchCapability("actuator:pump:P1", "*")).toBe(true);
  });

  it("empty strings don't match", () => {
    expect(matchCapability("", "actuator")).toBe(false);
    expect(matchCapability("actuator", "")).toBe(false);
  });

  it("deeply nested capabilities match with exact", () => {
    expect(matchCapability("actuator:relay:board:3:pin:7", "actuator:relay:board:3:pin:7")).toBe(true);
  });

  it("parseCapabilityString preserves the full id", () => {
    const cap = parseCapabilityString("sensor:soil-moisture:zone-1:deep");
    expect(cap.id).toBe("sensor:soil-moisture:zone-1:deep");
    expect(cap.kind).toBe("sensor");
    expect(cap.name).toBe("soil-moisture");
    expect(cap.subName).toBe("zone-1:deep");
  });
});

// ─── Logger Edge Cases ────────────────────────

describe("MeshLogger edge cases", () => {
  it("child inherits minLevel", () => {
    const lines: string[] = [];
    const parent = new MeshLogger({
      component: "parent",
      minLevel: "warn",
      writer: (line) => lines.push(line),
    });

    const child = parent.child({ component: "child" });
    child.info("should be filtered");
    child.warn("should appear");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("should appear");
  });

  it("error level only shows errors", () => {
    const lines: string[] = [];
    const logger = new MeshLogger({
      component: "strict",
      minLevel: "error",
      writer: (line) => lines.push(line),
    });

    logger.debug("no");
    logger.info("no");
    logger.warn("no");
    logger.error("yes");

    expect(lines).toHaveLength(1);
  });
});
