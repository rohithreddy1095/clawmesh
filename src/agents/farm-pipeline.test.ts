/**
 * Farm Pipeline Integration Tests — validates the complete sensor → threshold →
 * trigger queue → planner cycle WITHOUT LLM calls.
 *
 * This tests the real wiring between:
 *   - MockSensor broadcasting observations
 *   - ContextPropagator → WorldModel ingestion
 *   - ThresholdChecker detecting breaches
 *   - TriggerQueue prioritizing triggers
 *   - FarmContextLoader producing farm context
 *   - SystemPromptBuilder constructing prompts
 *   - PatternMemory learning from decisions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContextPropagator } from "../mesh/context-propagator.js";
import { WorldModel, scoreFrameRelevance } from "../mesh/world-model.js";
import { PeerRegistry } from "../mesh/peer-registry.js";
import { MeshEventBus } from "../mesh/event-bus.js";
import { TriggerQueue } from "./trigger-queue.js";
import { checkThresholdBreach, isPermanentLLMError } from "./threshold-checker.js";
import { PatternMemory, mergeSourceCounters, aggregateSourceCounters } from "./pattern-memory.js";
import { buildPlannerSystemPrompt } from "./system-prompt-builder.js";
import { loadBhoomiContext } from "./farm-context-loader.js";
import type { ContextFrame } from "../mesh/context-types.js";
import type { DeviceIdentity } from "../infra/device-identity.js";
import type { ThresholdRule } from "./types.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const noop = { info: () => {} };
const fakeIdentity: DeviceIdentity = {
  deviceId: "farm-test-device",
  publicKeyPem: "fake",
  privateKeyPem: "fake",
};

describe("Farm Pipeline: Sensor → Threshold → Trigger Queue", () => {
  let propagator: ContextPropagator;
  let worldModel: WorldModel;
  let bus: MeshEventBus;
  let triggerQueue: TriggerQueue;
  let thresholdRules: ThresholdRule[];
  let lastFired: Map<string, number>;

  beforeEach(() => {
    const registry = new PeerRegistry();
    propagator = new ContextPropagator({
      identity: fakeIdentity,
      peerRegistry: registry,
      log: noop,
    });
    worldModel = new WorldModel({ log: noop });
    bus = new MeshEventBus();
    triggerQueue = new TriggerQueue();
    lastFired = new Map();

    thresholdRules = [
      { ruleId: "moisture-critical", metric: "moisture", zone: "zone-1", belowThreshold: 20, cooldownMs: 5000, promptHint: "Moisture critically low" },
      { ruleId: "temp-high", metric: "temperature", aboveThreshold: 40, cooldownMs: 5000, promptHint: "Temperature dangerously high" },
    ];

    // Wire: propagator → world model → event bus → threshold check → trigger queue
    propagator.onLocalBroadcast = (frame) => {
      worldModel.ingest(frame);
      bus.emit("context.frame.ingested", { frame });
    };

    bus.on("context.frame.ingested", ({ frame }) => {
      for (const rule of thresholdRules) {
        const fired = lastFired.get(rule.ruleId) ?? 0;
        if (checkThresholdBreach(rule, frame, fired)) {
          lastFired.set(rule.ruleId, Date.now());
          triggerQueue.enqueueThresholdBreach({
            ruleId: rule.ruleId,
            promptHint: rule.promptHint,
            metric: rule.metric,
            zone: rule.zone,
            frame,
          });
        }
      }
    });
  });

  it("normal moisture reading does NOT trigger threshold", () => {
    propagator.broadcastObservation({
      data: { metric: "moisture", value: 30, zone: "zone-1" },
    });
    expect(triggerQueue.isEmpty).toBe(true);
  });

  it("critical moisture reading triggers threshold breach", () => {
    propagator.broadcastObservation({
      data: { metric: "moisture", value: 12, zone: "zone-1" },
    });
    expect(triggerQueue.isEmpty).toBe(false);
    const { systemTriggers } = triggerQueue.drain();
    expect(systemTriggers).toHaveLength(1);
    expect(systemTriggers[0].reason).toContain("moisture-critical");
  });

  it("high temperature triggers threshold breach", () => {
    propagator.broadcastObservation({
      data: { metric: "temperature", value: 45, zone: "zone-1" },
    });
    const { systemTriggers } = triggerQueue.drain();
    expect(systemTriggers).toHaveLength(1);
    expect(systemTriggers[0].reason).toContain("temp-high");
  });

  it("multiple breaches from different rules are queued", () => {
    propagator.broadcastObservation({
      data: { metric: "moisture", value: 10, zone: "zone-1" },
    });
    propagator.broadcastObservation({
      data: { metric: "temperature", value: 42, zone: "zone-1" },
    });
    const { systemTriggers } = triggerQueue.drain();
    expect(systemTriggers).toHaveLength(2);
  });

  it("operator intent has priority over threshold breaches", () => {
    propagator.broadcastObservation({
      data: { metric: "moisture", value: 8, zone: "zone-1" },
    });
    triggerQueue.enqueueIntent("emergency: stop all pumps");

    const { operatorIntents, systemTriggers } = triggerQueue.drain();
    expect(operatorIntents).toHaveLength(1);
    expect(systemTriggers).toHaveLength(1);
  });

  it("world model captures all frames for LLM context", () => {
    propagator.broadcastObservation({ data: { metric: "moisture", value: 30, zone: "zone-1" } });
    propagator.broadcastObservation({ data: { metric: "temperature", value: 28, zone: "zone-1" } });

    expect(worldModel.size).toBe(2);
    const summary = worldModel.summarize();
    expect(summary).toContain("zone-1");
    expect(summary).toContain("moisture=30");
  });
});

describe("Farm Pipeline: Pattern Learning", () => {
  it("records approval decision and builds confidence", () => {
    const dir = mkdtempSync(join(tmpdir(), "farm-pat-"));
    const memory = new PatternMemory({
      persistPath: join(dir, "patterns.json"),
      localDeviceId: "mac-main",
      log: noop,
    });

    memory.recordDecision({
      approved: true,
      triggerCondition: "moisture < 20 in zone-1",
      metric: "moisture",
      zone: "zone-1",
      action: { operation: "start", targetRef: "actuator:pump:P1", summary: "Start pump" },
      triggerEventId: "event-1",
    });

    const patterns = memory.getAllPatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0].confidence).toBe(1.0);
    expect(patterns[0].approvalCount).toBe(1);
  });

  it("CRDT merge preserves concurrent decisions", () => {
    const localCounters = { "node-A": { approvals: 3, rejections: 0 } };
    const remoteCounters = { "node-B": { approvals: 0, rejections: 2 } };

    const merged = mergeSourceCounters(localCounters, remoteCounters);
    const totals = aggregateSourceCounters(merged);

    expect(totals.approvals).toBe(3);
    expect(totals.rejections).toBe(2);
  });
});

describe("Farm Pipeline: System Prompt", () => {
  it("builds prompt from real Bhoomi farm data", () => {
    const farmContext = loadBhoomiContext();
    const prompt = buildPlannerSystemPrompt({
      nodeName: "mac-main",
      farmContext,
    });

    expect(prompt).toContain("mac-main");
    expect(prompt).toContain("Bhoomi");
    expect(prompt).toContain("Safety Rules");
    expect(prompt).toContain("LLM alone NEVER triggers physical actuation");
  });
});

describe("Farm Pipeline: LLM Error Classification", () => {
  it("classifies common errors correctly", () => {
    expect(isPermanentLLMError(new Error("429 Too Many Requests"))).toBe(false);
    expect(isPermanentLLMError(new Error("403 Forbidden"))).toBe(true);
    expect(isPermanentLLMError(new Error("ECONNRESET"))).toBe(false);
    expect(isPermanentLLMError(new Error("Account disabled"))).toBe(true);
  });
});
