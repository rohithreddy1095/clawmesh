/**
 * Tests for MetricsCollector — operational metrics tracking.
 */

import { describe, it, expect } from "vitest";
import { MetricsCollector, MESH_METRICS } from "./metrics-collector.js";

describe("MetricsCollector counters", () => {
  it("increments counter by 1", () => {
    const m = new MetricsCollector();
    m.inc("requests");
    m.inc("requests");
    expect(m.getCounter("requests")).toBe(2);
  });

  it("increments counter by custom delta", () => {
    const m = new MetricsCollector();
    m.inc("bytes", 1024);
    m.inc("bytes", 2048);
    expect(m.getCounter("bytes")).toBe(3072);
  });

  it("returns 0 for unknown counter", () => {
    const m = new MetricsCollector();
    expect(m.getCounter("nonexistent")).toBe(0);
  });

  it("resetCounters clears only counters", () => {
    const m = new MetricsCollector();
    m.inc("requests");
    m.set("peers", 5);
    m.resetCounters();
    expect(m.getCounter("requests")).toBe(0);
    expect(m.getGauge("peers")).toBe(5); // Gauge preserved
  });
});

describe("MetricsCollector gauges", () => {
  it("sets gauge to value", () => {
    const m = new MetricsCollector();
    m.set("peers", 3);
    expect(m.getGauge("peers")).toBe(3);
  });

  it("overwrites previous gauge value", () => {
    const m = new MetricsCollector();
    m.set("peers", 3);
    m.set("peers", 5);
    expect(m.getGauge("peers")).toBe(5);
  });

  it("returns 0 for unknown gauge", () => {
    const m = new MetricsCollector();
    expect(m.getGauge("nonexistent")).toBe(0);
  });
});

describe("MetricsCollector snapshot", () => {
  it("returns all metrics", () => {
    const m = new MetricsCollector();
    m.inc("requests", 10);
    m.set("peers", 3);
    const snap = m.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap.find(s => s.name === "requests")?.value).toBe(10);
    expect(snap.find(s => s.name === "requests")?.type).toBe("counter");
    expect(snap.find(s => s.name === "peers")?.value).toBe(3);
    expect(snap.find(s => s.name === "peers")?.type).toBe("gauge");
  });

  it("returns empty for fresh collector", () => {
    const m = new MetricsCollector();
    expect(m.snapshot()).toEqual([]);
  });
});

describe("MetricsCollector reset", () => {
  it("clears everything", () => {
    const m = new MetricsCollector();
    m.inc("a");
    m.set("b", 1);
    expect(m.size).toBe(2);
    m.reset();
    expect(m.size).toBe(0);
  });
});

describe("MESH_METRICS constants", () => {
  it("has inbound message metrics", () => {
    expect(MESH_METRICS.INBOUND_MESSAGES).toBe("mesh.inbound.messages");
    expect(MESH_METRICS.INBOUND_RATE_LIMITED).toBe("mesh.inbound.rate_limited");
    expect(MESH_METRICS.INBOUND_REJECTED).toBe("mesh.inbound.rejected");
  });

  it("has RPC metrics", () => {
    expect(MESH_METRICS.RPC_REQUESTS).toBe("mesh.rpc.requests");
    expect(MESH_METRICS.RPC_ERRORS).toBe("mesh.rpc.errors");
  });

  it("has LLM metrics", () => {
    expect(MESH_METRICS.LLM_CALLS).toBe("mesh.llm.calls");
    expect(MESH_METRICS.LLM_ERRORS).toBe("mesh.llm.errors");
  });

  it("all metric names follow mesh.* convention", () => {
    for (const value of Object.values(MESH_METRICS)) {
      expect(value).toMatch(/^mesh\./);
    }
  });
});

describe("MetricsCollector production usage", () => {
  it("tracks inbound message pipeline", () => {
    const m = new MetricsCollector();

    // Simulate inbound message processing
    m.inc(MESH_METRICS.INBOUND_MESSAGES);
    m.inc(MESH_METRICS.INBOUND_MESSAGES);
    m.inc(MESH_METRICS.INBOUND_RATE_LIMITED); // One rate-limited
    m.inc(MESH_METRICS.FRAMES_INGESTED);

    expect(m.getCounter(MESH_METRICS.INBOUND_MESSAGES)).toBe(2);
    expect(m.getCounter(MESH_METRICS.INBOUND_RATE_LIMITED)).toBe(1);
    expect(m.getCounter(MESH_METRICS.FRAMES_INGESTED)).toBe(1);
  });

  it("tracks peer connection gauge", () => {
    const m = new MetricsCollector();
    m.set(MESH_METRICS.PEERS_CONNECTED, 0);
    m.set(MESH_METRICS.PEERS_CONNECTED, 3); // 3 peers connect
    m.set(MESH_METRICS.PEERS_CONNECTED, 2); // 1 disconnects
    expect(m.getGauge(MESH_METRICS.PEERS_CONNECTED)).toBe(2);
  });
});
