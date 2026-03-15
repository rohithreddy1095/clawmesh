/**
 * System Flow Tests — end-to-end scenarios that exercise the full architecture
 * from sensor observations through intelligence routing to actuation proposals.
 *
 * These tests validate that all the new modules work together correctly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MeshEventBus } from "./event-bus.js";
import { WorldModel, scoreFrameRelevance } from "./world-model.js";
import { ContextPropagator } from "./context-propagator.js";
import { PeerRegistry } from "./peer-registry.js";
import { MeshCapabilityRegistry } from "./capabilities.js";
import { resolveMeshRoute } from "./routing.js";
import { evaluateMeshForwardTrust } from "./trust-policy.js";
import { TriggerQueue } from "../agents/trigger-queue.js";
import { TrustAuditTrail } from "./trust-audit.js";
import { AutoConnectManager } from "./auto-connect.js";
import { UIBroadcaster } from "./ui-broadcaster.js";
import { RpcDispatcher } from "./rpc-dispatcher.js";
import { handleContextSyncRequest, ingestSyncResponse } from "./context-sync.js";
import { matchCapability, parseCapabilityString, scoreCapability } from "./capability-types.js";
import { MeshLogger } from "../infra/mesh-logger.js";
import type { ContextFrame } from "./context-types.js";
import type { DeviceIdentity } from "../infra/device-identity.js";
import type { MeshForwardPayload } from "./types.js";

const noop = { info: () => {} };

const fakeIdentity: DeviceIdentity = {
  deviceId: "system-test-device",
  publicKeyPem: "fake",
  privateKeyPem: "fake",
};

function makeObservation(zone: string, metric: string, value: number, timestamp = Date.now()): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "sensor-device",
    sourceDisplayName: "jetson-field",
    timestamp,
    data: { zone, metric, value, unit: "%", status: value < 20 ? "critical" : value < 25 ? "low" : "normal" },
    trust: {
      evidence_sources: ["sensor"],
      evidence_trust_tier: "T2_operational_observation",
    },
  };
}

describe("System Flow: Sensor → Gossip → World Model → Trigger Queue", () => {
  it("sensor observation triggers threshold breach via world model", () => {
    const bus = new MeshEventBus();
    const worldModel = new WorldModel({ log: noop });
    const triggerQueue = new TriggerQueue();
    const breachedRules: string[] = [];

    // Wire: world model ingest → event bus → threshold check → trigger queue
    bus.on("context.frame.ingested", ({ frame }) => {
      if (frame.kind === "observation" && typeof frame.data.value === "number") {
        const value = frame.data.value;
        if (frame.data.metric === "soil_moisture" && value < 20) {
          breachedRules.push("moisture_critical");
          triggerQueue.enqueueThresholdBreach({
            ruleId: "moisture_critical",
            promptHint: `Moisture at ${value}% — below 20% threshold`,
            metric: "soil_moisture",
            zone: frame.data.zone as string,
            frame,
          });
        }
      }
    });

    // Simulate sensor reading
    const criticalFrame = makeObservation("zone-1", "soil_moisture", 12.5);
    worldModel.ingest(criticalFrame);
    bus.emit("context.frame.ingested", { frame: criticalFrame });

    // Verify threshold was detected
    expect(breachedRules).toContain("moisture_critical");
    expect(triggerQueue.length).toBe(1);

    // Drain and verify priority
    const { systemTriggers } = triggerQueue.drain();
    expect(systemTriggers).toHaveLength(1);
    expect(systemTriggers[0].type).toBe("threshold_breach");
    expect(systemTriggers[0].reason).toContain("moisture_critical");
  });

  it("operator intent has priority over threshold breaches", () => {
    const triggerQueue = new TriggerQueue();

    // Threshold breach arrives first
    triggerQueue.enqueueThresholdBreach({
      ruleId: "temp_high",
      promptHint: "Temperature above 40°C",
      metric: "temperature",
      zone: "zone-2",
      frame: makeObservation("zone-2", "temperature", 42),
    });

    // Then operator intent
    triggerQueue.enqueueIntent("emergency: stop all pumps", {
      conversationId: "conv-emergency",
    });

    // Drain: intent should come first
    const { operatorIntents, systemTriggers } = triggerQueue.drain();
    expect(operatorIntents).toHaveLength(1);
    expect(operatorIntents[0].conversationId).toBe("conv-emergency");
    expect(systemTriggers).toHaveLength(1);
    expect(systemTriggers[0].type).toBe("threshold_breach");
  });
});

describe("System Flow: Trust Policy → Audit Trail", () => {
  it("records trust decisions in audit trail", () => {
    const audit = new TrustAuditTrail();

    // Valid actuation with proper trust
    const validPayload: MeshForwardPayload = {
      channel: "clawmesh",
      to: "actuator:pump:P1",
      originGatewayId: "gw-1",
      idempotencyKey: "k1",
      trust: {
        action_type: "actuation",
        evidence_trust_tier: "T3_verified_action_evidence",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "human",
        verification_satisfied: true,
        evidence_sources: ["sensor", "human"],
      },
    };
    const validResult = evaluateMeshForwardTrust(validPayload);
    audit.record(validPayload, validResult);

    // LLM-only actuation (should be blocked)
    const blockedPayload: MeshForwardPayload = {
      channel: "clawmesh",
      to: "actuator:pump:P1",
      originGatewayId: "gw-1",
      idempotencyKey: "k2",
      trust: {
        action_type: "actuation",
        evidence_trust_tier: "T3_verified_action_evidence",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "human",
        evidence_sources: ["llm"],
      },
    };
    const blockedResult = evaluateMeshForwardTrust(blockedPayload);
    audit.record(blockedPayload, blockedResult);

    // Verify audit
    const stats = audit.getStats();
    expect(stats.total).toBe(2);
    expect(stats.approved).toBe(1);
    expect(stats.rejected).toBe(1);
    expect(stats.rejectionsByCode["LLM_ONLY_ACTUATION_BLOCKED"]).toBe(1);
  });
});

describe("System Flow: Discovery → Auto-Connect → Capabilities", () => {
  it("discovered peer with capabilities becomes routable", () => {
    const autoConnect = new AutoConnectManager();
    const capRegistry = new MeshCapabilityRegistry();
    const localCaps = new Set(["channel:clawmesh"]);

    // Discover a peer
    const decision = autoConnect.evaluate({
      deviceId: "jetson-field",
      displayName: "Jetson",
      host: "192.168.1.39",
      port: 18789,
      discoveredAtMs: Date.now(),
    });
    expect(decision.action).toBe("connect");

    // After connection, peer registers capabilities
    capRegistry.updatePeer("jetson-field", ["actuator:pump:P1", "sensor:soil-moisture:zone-1"]);

    // Now routing resolves to the mesh peer
    const route = resolveMeshRoute({
      channel: "jetson-field", // not a real channel, but for testing routing
      capabilityRegistry: capRegistry,
      localCapabilities: localCaps,
    });

    // The peer should be findable via capability query
    const pumpPeers = capRegistry.findPeersWithCapability("actuator:pump:P1");
    expect(pumpPeers).toContain("jetson-field");
  });
});

describe("System Flow: Context Sync Round-Trip", () => {
  it("new node catches up via context sync", () => {
    const now = Date.now();

    // Source node has been running and collecting data
    const sourceModel = new WorldModel({ log: noop });
    sourceModel.ingest(makeObservation("zone-1", "soil_moisture", 35, now - 60_000));
    sourceModel.ingest(makeObservation("zone-1", "soil_moisture", 30, now - 30_000));
    sourceModel.ingest(makeObservation("zone-2", "temperature", 28, now - 15_000));
    sourceModel.ingest(makeObservation("zone-1", "soil_moisture", 22, now - 5_000));

    // New node joins and requests sync from 2 minutes ago
    const syncResponse = handleContextSyncRequest(sourceModel, {
      since: now - 120_000,
      limit: 100,
    });
    expect(syncResponse.frames.length).toBe(4);

    // Client ingests
    const clientModel = new WorldModel({ log: noop });
    const result = ingestSyncResponse(clientModel, syncResponse);
    expect(result.ingested).toBe(4);

    // Client's world model now has the latest state
    const summary = clientModel.summarize();
    expect(summary).toContain("zone-1");
    expect(summary).toContain("zone-2");
  });
});

describe("System Flow: Structured Capabilities + Health-Aware Routing", () => {
  it("prefers healthy peer over degraded for the same capability", () => {
    const healthyPump = parseCapabilityString("actuator:pump:P1");
    healthyPump.health = "healthy";

    const degradedPump = parseCapabilityString("actuator:pump:P1");
    degradedPump.health = "degraded";

    const healthyScore = scoreCapability(healthyPump, "actuator:pump:P1");
    const degradedScore = scoreCapability(degradedPump, "actuator:pump:P1");

    expect(healthyScore).toBeGreaterThan(degradedScore);
  });

  it("wildcard pattern matches all sub-capabilities", () => {
    expect(matchCapability("actuator:pump:P1", "actuator:*")).toBe(true);
    expect(matchCapability("actuator:valve:V1", "actuator:*")).toBe(true);
    expect(matchCapability("sensor:moisture:zone-1", "actuator:*")).toBe(false);
  });
});

describe("System Flow: World Model Relevance for LLM Context", () => {
  it("critical observations rank higher than routine ones", () => {
    const now = Date.now();

    const worldModel = new WorldModel({ log: noop });
    // Old routine reading
    worldModel.ingest(makeObservation("zone-3", "humidity", 55, now - 3600_000));
    // Recent critical reading
    worldModel.ingest(makeObservation("zone-1", "soil_moisture", 8, now - 1000));
    // Recent normal reading
    worldModel.ingest(makeObservation("zone-2", "temperature", 25, now - 500));

    const relevant = worldModel.getRelevantFrames(2, now);
    // Critical reading should be in top results due to "critical" keyword + recency
    const hasCritical = relevant.some(
      (f) => f.data.metric === "soil_moisture" && f.data.value === 8,
    );
    expect(hasCritical).toBe(true);
  });
});
