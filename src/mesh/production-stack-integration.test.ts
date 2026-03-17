/**
 * Full production stack integration tests — validates all production modules
 * work together as they would in a real mesh node.
 */

import { describe, it, expect } from "vitest";
import { MetricsCollector, MESH_METRICS } from "./metrics-collector.js";
import { RateLimiter } from "./rate-limiter.js";
import { ConnectionHealthMonitor } from "./connection-health.js";
import { validateMessageSize, validateAndParse } from "./message-validation.js";
import { computeHealthCheck, type HealthCheckDeps } from "./health-check.js";
import { PeerRegistry } from "./peer-registry.js";
import { MeshCapabilityRegistry } from "./capabilities.js";
import { WorldModel } from "./world-model.js";

function makeDeps(): HealthCheckDeps {
  return {
    nodeId: "test-device-0123456789ab",
    displayName: "Test Node",
    startedAtMs: Date.now() - 60_000,
    version: "0.2.0",
    localCapabilities: ["sensor:moisture"],
    peerRegistry: new PeerRegistry(),
    capabilityRegistry: new MeshCapabilityRegistry(),
    worldModel: new WorldModel({ autoEvictTtlMs: 0, log: { info: () => {} } }),
    getPlannerMode: () => "active",
  };
}

describe("Production stack: inbound message pipeline", () => {
  it("message goes through rate limit → size check → parse → metrics", () => {
    const metrics = new MetricsCollector();
    const limiter = new RateLimiter({ maxRequests: 10, windowMs: 60_000 });
    const connId = "conn-abc";

    // Simulate 5 valid messages
    for (let i = 0; i < 5; i++) {
      metrics.inc(MESH_METRICS.INBOUND_MESSAGES);
      if (!limiter.allow(connId)) {
        metrics.inc(MESH_METRICS.INBOUND_RATE_LIMITED);
        continue;
      }
      const raw = JSON.stringify({ type: "event", event: "context.frame", payload: {} });
      const sizeOk = validateMessageSize(raw);
      if (!sizeOk.valid) {
        metrics.inc(MESH_METRICS.INBOUND_REJECTED);
        continue;
      }
      metrics.inc(MESH_METRICS.FRAMES_INGESTED);
    }

    expect(metrics.getCounter(MESH_METRICS.INBOUND_MESSAGES)).toBe(5);
    expect(metrics.getCounter(MESH_METRICS.FRAMES_INGESTED)).toBe(5);
    expect(metrics.getCounter(MESH_METRICS.INBOUND_RATE_LIMITED)).toBe(0);
    expect(metrics.getCounter(MESH_METRICS.INBOUND_REJECTED)).toBe(0);
  });

  it("oversized message is rejected before parsing", () => {
    const metrics = new MetricsCollector();
    const oversized = "x".repeat(1_048_577); // > 1MB
    metrics.inc(MESH_METRICS.INBOUND_MESSAGES);
    const sizeOk = validateMessageSize(oversized);
    if (!sizeOk.valid) {
      metrics.inc(MESH_METRICS.INBOUND_REJECTED);
    }
    expect(metrics.getCounter(MESH_METRICS.INBOUND_REJECTED)).toBe(1);
  });
});

describe("Production stack: health check with metrics", () => {
  it("computeHealthCheck returns full node status", () => {
    const deps = makeDeps();
    const result = computeHealthCheck(deps);

    expect(result.status).toBe("healthy");
    expect(result.nodeId).toContain("test-device");
    expect(result.uptimeMs).toBeGreaterThan(0);
    expect(result.version).toBe("0.2.0");
    expect(result.peers.connected).toBe(0);
    expect(result.capabilities.local).toContain("sensor:moisture");
    expect(result.plannerMode).toBe("active");
  });

  it("health degrades when planner is suspended", () => {
    const deps = makeDeps();
    deps.getPlannerMode = () => "suspended";
    const result = computeHealthCheck(deps);
    expect(result.status).toBe("degraded");
  });
});

describe("Production stack: connection health + metrics", () => {
  it("stale peer detection updates metrics", () => {
    const metrics = new MetricsCollector();
    const health = new ConnectionHealthMonitor({
      staleThresholdMs: 100,
      onStaleDetected: () => { metrics.inc("mesh.peers.stale_detected"); },
    });

    const now = Date.now();
    (health as any).lastSeen.set("peer-old", now - 200);
    health.checkAll(now);

    expect(metrics.getCounter("mesh.peers.stale_detected")).toBe(1);
  });
});

describe("Production stack: validateAndParse pipeline", () => {
  it("valid RPC request passes all checks", () => {
    const msg = JSON.stringify({
      type: "req",
      id: "req-001",
      method: "mesh.health",
      params: {},
    });
    const result = validateAndParse(msg);
    expect(result.parsed).not.toBeNull();
    expect(result.parsed?.method).toBe("mesh.health");
  });

  it("valid event passes all checks", () => {
    const msg = JSON.stringify({
      type: "event",
      event: "context.frame",
      payload: { kind: "observation", data: { metric: "m", value: 1 } },
    });
    const result = validateAndParse(msg);
    expect(result.parsed).not.toBeNull();
  });
});
