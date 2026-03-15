/**
 * Smoke tests — verify all new architecture modules import cleanly
 * and export expected types/functions.
 */

import { describe, it, expect } from "vitest";

describe("new module imports", () => {
  it("imports MeshEventBus", async () => {
    const { MeshEventBus } = await import("./event-bus.js");
    expect(MeshEventBus).toBeDefined();
    const bus = new MeshEventBus();
    expect(bus.listenerCount("peer.connected")).toBe(0);
  });

  it("imports Transport + MockTransport", async () => {
    const { MockTransport, TransportState, WebSocketTransport } = await import("./transport.js");
    expect(MockTransport).toBeDefined();
    expect(TransportState.OPEN).toBe(1);
    expect(WebSocketTransport).toBeDefined();
  });

  it("imports RpcDispatcher", async () => {
    const { RpcDispatcher } = await import("./rpc-dispatcher.js");
    expect(RpcDispatcher).toBeDefined();
    expect(RpcDispatcher.parseRequest).toBeDefined();
    expect(RpcDispatcher.parseResponse).toBeDefined();
  });

  it("imports ContextSync", async () => {
    const { handleContextSyncRequest, ingestSyncResponse, calculateSyncSince } = await import("./context-sync.js");
    expect(handleContextSyncRequest).toBeDefined();
    expect(ingestSyncResponse).toBeDefined();
    expect(calculateSyncSince).toBeDefined();
  });

  it("imports HealthCheck", async () => {
    const { computeHealthCheck, createHealthCheckHandlers } = await import("./health-check.js");
    expect(computeHealthCheck).toBeDefined();
    expect(createHealthCheckHandlers).toBeDefined();
  });

  it("imports AutoConnectManager", async () => {
    const { AutoConnectManager } = await import("./auto-connect.js");
    const mgr = new AutoConnectManager();
    expect(mgr.getAttemptCount("test")).toBe(0);
  });

  it("imports IntentRouter", async () => {
    const { extractIntentFromForward, routeIntent } = await import("./intent-router.js");
    expect(extractIntentFromForward).toBeDefined();
    expect(routeIntent).toBeDefined();
  });

  it("imports UIBroadcaster", async () => {
    const { UIBroadcaster } = await import("./ui-broadcaster.js");
    const b = new UIBroadcaster();
    expect(b.subscriberCount).toBe(0);
  });

  it("imports CapabilityTypes", async () => {
    const { parseCapabilityString, matchCapability, scoreCapability } = await import("./capability-types.js");
    expect(parseCapabilityString("channel:test").kind).toBe("channel");
    expect(matchCapability("a:b", "a:b")).toBe(true);
    expect(scoreCapability).toBeDefined();
  });

  it("imports TrustAuditTrail", async () => {
    const { TrustAuditTrail } = await import("./trust-audit.js");
    const audit = new TrustAuditTrail();
    expect(audit.size).toBe(0);
  });

  it("imports WorldModel with new methods", async () => {
    const { WorldModel, scoreFrameRelevance } = await import("./world-model.js");
    const model = new WorldModel({ log: { info: () => {} } });
    expect(model.getRelevantFrames).toBeDefined();
    expect(model.evictStale).toBeDefined();
    expect(model.summarize).toBeDefined();
    expect(scoreFrameRelevance).toBeDefined();
  });

  it("imports TriggerQueue", async () => {
    const { TriggerQueue, TRIGGER_PRIORITIES } = await import("../agents/trigger-queue.js");
    expect(TriggerQueue).toBeDefined();
    expect(TRIGGER_PRIORITIES.operator_intent).toBe(0);
  });

  it("imports PatternMemory with CRDT helpers", async () => {
    const { PatternMemory, mergeSourceCounters, aggregateSourceCounters } = await import("../agents/pattern-memory.js");
    expect(PatternMemory).toBeDefined();
    expect(mergeSourceCounters).toBeDefined();
    expect(aggregateSourceCounters).toBeDefined();
  });

  it("imports MeshLogger", async () => {
    const { MeshLogger, createStructuredLogger } = await import("../infra/mesh-logger.js");
    expect(MeshLogger).toBeDefined();
    expect(createStructuredLogger).toBeDefined();
  });

  it("imports context sync server handler", async () => {
    const { createContextSyncHandlers } = await import("./server-methods/context-sync.js");
    expect(createContextSyncHandlers).toBeDefined();
  });
});
