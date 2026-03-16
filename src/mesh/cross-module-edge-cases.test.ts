/**
 * Cross-module edge case tests — validates boundary conditions across
 * multiple interacting modules.
 */

import { describe, it, expect, vi } from "vitest";
import { MeshEventBus } from "./event-bus.js";
import { WorldModel, scoreFrameRelevance } from "./world-model.js";
import { ContextPropagator } from "./context-propagator.js";
import { PeerRegistry } from "./peer-registry.js";
import { MeshCapabilityRegistry } from "./capabilities.js";
import { resolveCapabilityRoute } from "./capability-router.js";
import { RpcDispatcher } from "./rpc-dispatcher.js";
import { UIBroadcaster } from "./ui-broadcaster.js";
import { TriggerQueue } from "../agents/trigger-queue.js";
import { TrustAuditTrail } from "./trust-audit.js";
import { handleContextSyncRequest, ingestSyncResponse } from "./context-sync.js";
import { computeHealthCheck, type HealthCheckDeps } from "./health-check.js";
import { routeInboundMessage, type MessageRouterDeps } from "./message-router.js";
import { matchCapability, parseCapabilityString, scoreCapability } from "./capability-types.js";
import { sendActuation, defaultActuationTrust } from "./actuation-sender.js";
import { PeerConnectionManager } from "./peer-connection-manager.js";
import { AutoConnectManager } from "./auto-connect.js";
import type { ContextFrame } from "./context-types.js";
import type { DeviceIdentity } from "../infra/device-identity.js";

const noop = { info: () => {} };
const fakeId: DeviceIdentity = { deviceId: "test-dev", publicKeyPem: "f", privateKeyPem: "f" };

function makeObs(zone: string, metric: string, value: number): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "sensor",
    timestamp: Date.now(),
    data: { zone, metric, value },
    trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
  };
}

describe("Event Bus + World Model + Health Check", () => {
  it("health check reflects world model state after event-driven ingestion", () => {
    const bus = new MeshEventBus();
    const wm = new WorldModel({ log: noop });
    const pr = new PeerRegistry();
    const cr = new MeshCapabilityRegistry();

    bus.on("context.frame.ingested", ({ frame }) => { /* subscriber exists */ });

    wm.ingest(makeObs("z1", "moisture", 25));
    wm.ingest(makeObs("z2", "temp", 30));

    const health = computeHealthCheck({
      nodeId: "node", displayName: "n", startedAtMs: Date.now() - 60_000,
      version: "0.2.0", localCapabilities: [], peerRegistry: pr,
      capabilityRegistry: cr, worldModel: wm,
    });

    expect(health.worldModel.entries).toBe(2);
    expect(health.worldModel.frameLogSize).toBe(2);
    expect(health.status).toBe("degraded"); // no caps, no peers
  });
});

describe("Context Sync + World Model Relevance", () => {
  it("synced frames are scored by relevance correctly", () => {
    const source = new WorldModel({ log: noop });
    const now = Date.now();
    source.ingest(makeObs("z1", "moisture", 10)); // critical-ish
    source.ingest({ ...makeObs("z1", "temp", 30), kind: "human_input", trust: { evidence_sources: ["human"], evidence_trust_tier: "T3_verified_action_evidence" } });

    const response = handleContextSyncRequest(source, { since: 0 });
    const client = new WorldModel({ log: noop });
    ingestSyncResponse(client, response);

    const relevant = client.getRelevantFrames(2, now);
    // human_input should rank higher than observation
    expect(relevant[0].kind).toBe("human_input");
  });
});

describe("Capability Router + Health Map", () => {
  it("routes to healthiest peer when multiple have same capability", () => {
    const cr = new MeshCapabilityRegistry();
    cr.updatePeer("healthy-peer", ["actuator:pump:P1"]);
    cr.updatePeer("sick-peer", ["actuator:pump:P1"]);

    const healthMap = new Map();
    healthMap.set("healthy-peer", new Map([["actuator:pump:P1", "healthy" as const]]));
    healthMap.set("sick-peer", new Map([["actuator:pump:P1", "unhealthy" as const]]));

    const result = resolveCapabilityRoute({
      capability: "actuator:pump:P1",
      capabilityRegistry: cr,
      peerHealth: healthMap,
    });

    expect(result.kind).toBe("mesh");
    if (result.kind === "mesh") {
      expect(result.peerDeviceId).toBe("healthy-peer");
    }
  });
});

describe("TriggerQueue + World Model Eviction", () => {
  it("eviction doesn't affect pending triggers", () => {
    const wm = new WorldModel({ log: noop });
    const queue = new TriggerQueue();
    const now = Date.now();

    const frame = makeObs("z1", "moisture", 8);
    frame.timestamp = now - 7200_000; // 2 hours old
    wm.ingest(frame);

    queue.enqueueThresholdBreach({
      ruleId: "r1", promptHint: "dry", metric: "moisture", zone: "z1", frame,
    });

    // Evict stale world model entries
    wm.evictStale(3600_000); // 1 hour TTL
    expect(wm.size).toBe(0);

    // Trigger queue still has the breach
    expect(queue.isEmpty).toBe(false);
    const { systemTriggers } = queue.drain();
    expect(systemTriggers).toHaveLength(1);
  });
});

describe("Trust Audit + Actuation Sender", () => {
  it("actuation sender records both approvals and rejections in audit", async () => {
    const audit = new TrustAuditTrail();
    const registry = new PeerRegistry();

    // Approved actuation (default trust)
    await sendActuation(
      { peerDeviceId: "p", targetRef: "actuator:pump", operation: "start" },
      { peerRegistry: registry, deviceId: "dev", trustAudit: audit },
    );

    // Rejected actuation (LLM-only)
    await sendActuation(
      {
        peerDeviceId: "p", targetRef: "actuator:pump", operation: "start",
        trust: { action_type: "actuation", evidence_sources: ["llm"], evidence_trust_tier: "T3_verified_action_evidence", minimum_trust_tier: "T2_operational_observation", verification_required: "none" },
      },
      { peerRegistry: registry, deviceId: "dev", trustAudit: audit },
    );

    const stats = audit.getStats();
    expect(stats.total).toBe(2);
    expect(stats.approved).toBe(1);
    expect(stats.rejected).toBe(1);
  });
});

describe("Auto-Connect + Capability Registry", () => {
  it("discovered and connected peer becomes routable", () => {
    const ac = new AutoConnectManager();
    const cr = new MeshCapabilityRegistry();

    // Discover
    const decision = ac.evaluate({
      deviceId: "jetson", host: "10.0.0.1", port: 18789, discoveredAtMs: Date.now(),
    });
    expect(decision.action).toBe("connect");

    // After connection, register capabilities
    ac.markConnected("jetson");
    cr.updatePeer("jetson", ["actuator:pump:P1", "sensor:moisture:z1"]);

    // Now the peer is routable
    const route = resolveCapabilityRoute({
      capability: "actuator:pump:P1",
      capabilityRegistry: cr,
    });
    expect(route.kind).toBe("mesh");
  });
});

describe("Message Router + RPC Dispatcher", () => {
  it("routes RPC request through dispatcher to handler", async () => {
    const pr = new PeerRegistry();
    const cp = new ContextPropagator({ identity: fakeId, peerRegistry: pr, log: noop });
    const wm = new WorldModel({ log: noop });
    const bus = new MeshEventBus();
    const disp = new RpcDispatcher();

    disp.register("test.ping", ({ respond }) => respond(true, { pong: true }));

    const socket = { readyState: 1, send: vi.fn() };
    const result = await routeInboundMessage(
      JSON.stringify({ type: "req", id: "r1", method: "test.ping" }),
      socket as any, "c1",
      { peerRegistry: pr, contextPropagator: cp, worldModel: wm, eventBus: bus, rpcDispatcher: disp, intentRouterDeps: { deviceId: "d", contextPropagator: cp, broadcastToUI: () => {}, log: { info: () => {} } } },
    );

    expect(result.handled).toBe(true);
    expect(socket.send).toHaveBeenCalled();
    const resp = JSON.parse(socket.send.mock.calls[0][0]);
    expect(resp.ok).toBe(true);
    expect(resp.payload.pong).toBe(true);
  });
});

describe("UIBroadcaster + Event Bus", () => {
  it("event bus can trigger UI broadcasts", () => {
    const bus = new MeshEventBus();
    const uib = new UIBroadcaster();
    const sent: string[] = [];

    const mockWs = {
      readyState: 1,
      send: (data: string) => sent.push(data),
      addEventListener: () => {},
    };
    uib.addSubscriber(mockWs as any);

    bus.on("proposal.created", ({ proposal }) => {
      uib.broadcast("planner.proposal", proposal);
    });

    bus.emit("proposal.created", {
      proposal: {
        taskId: "t1", summary: "Test", reasoning: "r", targetRef: "a:p", operation: "start",
        peerDeviceId: "p", approvalLevel: "L2" as const, status: "awaiting_approval" as const,
        createdBy: "intelligence" as const, triggerFrameIds: [], createdAt: Date.now(),
      },
    });

    expect(sent).toHaveLength(1);
    const parsed = JSON.parse(sent[0]);
    expect(parsed.event).toBe("planner.proposal");
  });
});
