/**
 * Integration tests for architecture hardening — tests the wiring between
 * new modules (event bus, health check, context sync, auto-connect) and
 * existing components.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { MeshEventBus } from "./event-bus.js";
import { WorldModel, scoreFrameRelevance } from "./world-model.js";
import { MeshCapabilityRegistry } from "./capabilities.js";
import { PeerRegistry } from "./peer-registry.js";
import { computeHealthCheck, type HealthCheckDeps } from "./health-check.js";
import { handleContextSyncRequest, ingestSyncResponse, calculateSyncSince } from "./context-sync.js";
import { AutoConnectManager } from "./auto-connect.js";
import { RpcDispatcher } from "./rpc-dispatcher.js";
import { MockTransport, TransportState } from "./transport.js";
import { TriggerQueue } from "../agents/trigger-queue.js";
import { MeshLogger } from "../infra/mesh-logger.js";
import type { ContextFrame } from "./context-types.js";

const noop = { info: () => {} };

function makeFrame(overrides?: Partial<ContextFrame>): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "device-abc",
    sourceDisplayName: "sensor-node",
    timestamp: Date.now(),
    data: { metric: "soil_moisture", value: 25.3, zone: "zone-1" },
    trust: {
      evidence_sources: ["sensor"],
      evidence_trust_tier: "T2_operational_observation",
    },
    ...overrides,
  };
}

describe("Event Bus → World Model Integration", () => {
  it("event bus notifies subscribers when world model ingests", () => {
    const bus = new MeshEventBus();
    const worldModel = new WorldModel({ log: noop });
    const received: ContextFrame[] = [];

    bus.on("context.frame.ingested", ({ frame }) => {
      received.push(frame);
    });

    // Simulate the wiring: ingest → emit
    const frame = makeFrame();
    const isNew = worldModel.ingest(frame);
    if (isNew) {
      bus.emit("context.frame.ingested", { frame });
    }

    expect(received).toHaveLength(1);
    expect(received[0].frameId).toBe(frame.frameId);
  });

  it("deduplication prevents double-emission", () => {
    const bus = new MeshEventBus();
    const worldModel = new WorldModel({ log: noop });
    let emitCount = 0;

    bus.on("context.frame.ingested", () => { emitCount++; });

    const frame = makeFrame({ frameId: "dup" });
    if (worldModel.ingest(frame)) bus.emit("context.frame.ingested", { frame });
    if (worldModel.ingest(frame)) bus.emit("context.frame.ingested", { frame });

    expect(emitCount).toBe(1);
  });
});

describe("Context Sync → World Model Integration", () => {
  it("full sync round-trip: source → handler → ingest at client", () => {
    // Source node has frames
    const sourceModel = new WorldModel({ log: noop });
    const now = Date.now();
    sourceModel.ingest(makeFrame({ frameId: "f1", timestamp: now - 5000 }));
    sourceModel.ingest(makeFrame({ frameId: "f2", timestamp: now - 3000, data: { metric: "temp", value: 30, zone: "z2" } }));
    sourceModel.ingest(makeFrame({ frameId: "f3", timestamp: now - 1000, data: { metric: "humidity", value: 60, zone: "z3" } }));

    // Client requests sync since 4 seconds ago
    const response = handleContextSyncRequest(sourceModel, { since: now - 4000 });

    // Client ingests response
    const clientModel = new WorldModel({ log: noop });
    const result = ingestSyncResponse(clientModel, response);

    expect(result.ingested).toBe(2); // f2 and f3
    expect(result.duplicates).toBe(0);
    expect(clientModel.size).toBe(2);
  });

  it("calculateSyncSince with recent frame gives 1-minute buffer", () => {
    const lastKnown = Date.now() - 10 * 60_000; // 10 min ago
    const since = calculateSyncSince(lastKnown);
    expect(since).toBe(lastKnown - 60_000); // 1 minute before
  });
});

describe("Health Check Integration", () => {
  it("reports correct state with populated world model", () => {
    const worldModel = new WorldModel({ log: noop });
    worldModel.ingest(makeFrame({ frameId: "f1" }));
    worldModel.ingest(makeFrame({ frameId: "f2", data: { metric: "temp", value: 30, zone: "z2" } }));

    const capRegistry = new MeshCapabilityRegistry();
    capRegistry.updatePeer("peer-1", ["channel:telegram"]);

    const deps: HealthCheckDeps = {
      nodeId: "test-node-id-long",
      displayName: "test-node",
      startedAtMs: Date.now() - 120_000,
      version: "0.2.0",
      localCapabilities: ["channel:clawmesh"],
      peerRegistry: new PeerRegistry(),
      capabilityRegistry: capRegistry,
      worldModel,
      getPlannerMode: () => "active",
    };

    const result = computeHealthCheck(deps);
    expect(result.status).toBe("healthy");
    expect(result.worldModel.entries).toBe(2);
    expect(result.worldModel.frameLogSize).toBe(2);
    expect(result.capabilities.meshTotal).toBe(1);
    expect(result.plannerMode).toBe("active");
  });
});

describe("Auto-Connect → Discovery Integration", () => {
  it("evaluates discovered peers and manages connection state", () => {
    const manager = new AutoConnectManager();

    // Discover peer
    const decision1 = manager.evaluate({
      deviceId: "peer-123",
      displayName: "jetson-field",
      host: "192.168.1.39",
      port: 18789,
      discoveredAtMs: Date.now(),
    });
    expect(decision1.action).toBe("connect");

    // Mark connected
    manager.markConnected("peer-123");

    // Re-discover same peer — should skip
    const decision2 = manager.evaluate({
      deviceId: "peer-123",
      displayName: "jetson-field",
      host: "192.168.1.39",
      port: 18789,
      discoveredAtMs: Date.now(),
    });
    expect(decision2.action).toBe("skip");

    // Disconnect → re-discover
    manager.markDisconnected("peer-123");
    const decision3 = manager.evaluate({
      deviceId: "peer-123",
      displayName: "jetson-field",
      host: "192.168.1.39",
      port: 18789,
      discoveredAtMs: Date.now(),
    });
    expect(decision3.action).toBe("connect");
  });
});

describe("TriggerQueue → Planner Integration", () => {
  it("prioritizes operator intents over threshold breaches", () => {
    const queue = new TriggerQueue();

    // Add in reverse priority order
    queue.enqueueProactiveCheck([]);
    queue.enqueueThresholdBreach({
      ruleId: "r1",
      promptHint: "Moisture critical",
      metric: "soil_moisture",
      zone: "zone-1",
      frame: makeFrame(),
    });
    queue.enqueueIntent("irrigate zone-1 now", { conversationId: "conv-1" });

    const { operatorIntents, systemTriggers } = queue.drain();
    expect(operatorIntents).toHaveLength(1);
    expect(operatorIntents[0].conversationId).toBe("conv-1");
    expect(systemTriggers).toHaveLength(2);
    // System triggers should be sorted: threshold(1) before proactive(3)
    expect(systemTriggers[0].type).toBe("threshold_breach");
    expect(systemTriggers[1].type).toBe("proactive_check");
  });
});

describe("World Model Relevance + Summarize Integration", () => {
  it("relevance scoring prioritizes critical recent human input", () => {
    const now = Date.now();
    const human = makeFrame({
      kind: "human_input",
      timestamp: now,
      trust: { evidence_sources: ["human"], evidence_trust_tier: "T3_verified_action_evidence" },
    });
    const oldObs = makeFrame({
      kind: "observation",
      timestamp: now - 3600_000,
    });

    expect(scoreFrameRelevance(human, now)).toBeGreaterThan(
      scoreFrameRelevance(oldObs, now),
    );
  });

  it("summarize produces zone-grouped output", () => {
    const model = new WorldModel({ log: noop });
    model.ingest(makeFrame({ frameId: "z1", data: { metric: "moisture", value: 25, zone: "zone-1" } }));
    model.ingest(makeFrame({ frameId: "z2", data: { metric: "moisture", value: 40, zone: "zone-2" } }));

    const summary = model.summarize();
    expect(summary).toContain("zone-1");
    expect(summary).toContain("zone-2");
    expect(summary).toContain("moisture=25");
    expect(summary).toContain("moisture=40");
  });
});

describe("RPC Dispatcher + MockTransport Integration", () => {
  it("dispatcher sends response via mock transport's WebSocket-like interface", async () => {
    const dispatcher = new RpcDispatcher();
    dispatcher.register("echo", ({ params, respond }) => {
      respond(true, { echo: params.msg });
    });

    const transport = new MockTransport();
    // Use transport as socket-like object
    const mockSocket = {
      readyState: 1, // OPEN
      send: (data: string) => transport.send(data),
    };

    await dispatcher.dispatch(mockSocket as any, "conn-1", {
      type: "req",
      id: "req-1",
      method: "echo",
      params: { msg: "hello" },
    });

    expect(transport.sent).toHaveLength(1);
    const response = JSON.parse(transport.sent[0]);
    expect(response.ok).toBe(true);
    expect(response.payload).toEqual({ echo: "hello" });
  });
});

describe("MeshLogger Integration", () => {
  it("structured logger produces parseable JSON", () => {
    const lines: string[] = [];
    const logger = new MeshLogger({
      component: "mesh",
      output: "json",
      deviceId: "test-device",
      writer: (line) => lines.push(line),
    });

    logger.info("peer connected", { peerId: "abc", capabilities: 3 });
    logger.warn("rate limited");

    expect(lines).toHaveLength(2);
    const entry1 = JSON.parse(lines[0]);
    expect(entry1.component).toBe("mesh");
    expect(entry1.level).toBe("info");
    expect(entry1.data.peerId).toBe("abc");

    const entry2 = JSON.parse(lines[1]);
    expect(entry2.level).toBe("warn");
  });
});
