/**
 * Cross-module integration tests for Session 5 wiring.
 *
 * Validates that the extracted modules work correctly together
 * in the patterns PiSession uses them.
 */

import { describe, it, expect } from "vitest";
import { ModeController } from "./mode-controller.js";
import { ProposalManager } from "./proposal-manager.js";
import { ingestFrame, isPatternFrame, extractPatterns } from "./frame-ingestor.js";
import { isPermanentLLMError } from "./threshold-checker.js";
import { classifyEvent, extractAssistantText } from "./session-event-classifier.js";
import { buildOperatorPrompt, buildPlannerPrompt, cleanIntentText, extractCitations } from "./planner-prompt-builder.js";
import { buildPlannerSystemPrompt } from "./system-prompt-builder.js";
import { buildAgentResponseFrame, buildPatternGossipFrame } from "./broadcast-helpers.js";
import { hasAssistantContent, getLastMessage, findRecentProposalIds } from "./llm-response-helpers.js";
import { TriggerQueue } from "./trigger-queue.js";
import type { ContextFrame } from "../mesh/context-types.js";
import type { ThresholdRule, TaskProposal } from "./types.js";

function makeFrame(overrides?: Partial<ContextFrame>): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "sensor-01",
    timestamp: Date.now(),
    data: { metric: "soil_moisture", value: 12, zone: "zone-1" },
    trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    ...overrides,
  };
}

describe("Full operator intent pipeline", () => {
  it("intent → cleanIntentText → buildOperatorPrompt → session", () => {
    const raw = 'operator_intent: "check zone-1 moisture"';
    const cleaned = cleanIntentText(raw);
    expect(cleaned).toBe("check zone-1 moisture");

    const prompt = buildOperatorPrompt(cleaned, [], []);
    expect(prompt).toContain("[OPERATOR MESSAGE]");
    expect(prompt).toContain("check zone-1 moisture");
    expect(prompt).toContain("propose_task");
  });

  it("intent with system triggers and patterns", () => {
    const prompt = buildOperatorPrompt(
      "irrigate zone-1",
      [{ reason: "moisture-critical breach", priority: 1 }],
      [{
        triggerCondition: "moisture < 20%",
        action: { operation: "irrigate", targetRef: "pump-01" },
        confidence: 0.9,
        approvalCount: 5,
        rejectionCount: 0,
      }],
    );
    expect(prompt).toContain("irrigate zone-1");
    expect(prompt).toContain("moisture-critical breach");
    expect(prompt).toContain("LEARNED PATTERNS");
    expect(prompt).toContain("90%");
  });
});

describe("Full threshold breach pipeline", () => {
  it("frame → ingestFrame → TriggerQueue → buildPlannerPrompt", () => {
    const rules: ThresholdRule[] = [{
      ruleId: "moisture-critical",
      metric: "soil_moisture",
      belowThreshold: 20,
      promptHint: "Soil moisture critically low",
      cooldownMs: 0,
    }];

    const frame = makeFrame({ data: { metric: "soil_moisture", value: 8, zone: "zone-1" } });
    const result = ingestFrame(frame, rules, new Map());
    expect(result.breaches).toHaveLength(1);

    const queue = new TriggerQueue();
    for (const breach of result.breaches) {
      queue.enqueueThresholdBreach({
        ruleId: breach.ruleId,
        promptHint: breach.promptHint,
        metric: breach.metric,
        zone: breach.zone,
        frame,
      });
    }

    const { systemTriggers } = queue.drain();
    expect(systemTriggers).toHaveLength(1);

    const prompt = buildPlannerPrompt(systemTriggers);
    expect(prompt).toContain("moisture-critical");
    expect(prompt).toContain("[PLANNER CYCLE");
  });
});

describe("Full LLM response pipeline", () => {
  it("response → hasAssistantContent → extractAssistantText → buildAgentResponseFrame", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "text", text: "Zone-1 moisture is at 8%, which is critically low." },
        { type: "toolCall", name: "propose_task" },
      ],
    };

    expect(hasAssistantContent(message)).toBe(true);

    const text = extractAssistantText(message);
    expect(text).toContain("Zone-1 moisture");

    const frame = buildAgentResponseFrame(
      { message: text!, status: "complete", conversationId: "conv-1" },
      "device-01",
      "Farm Hub",
    );
    expect(frame.kind).toBe("agent_response");
    expect(frame.data.message).toContain("Zone-1 moisture");
  });

  it("empty response → no content → rate limit handling", () => {
    const message = { role: "assistant", content: [] };
    expect(hasAssistantContent(message)).toBe(false);
  });
});

describe("Full error handling pipeline", () => {
  it("error → isPermanentLLMError → ModeController → suspend", () => {
    const ctrl = new ModeController({ errorThreshold: 3 });
    const error = new Error("403 Forbidden: Account suspended");

    if (isPermanentLLMError(error)) {
      ctrl.recordFailure(String(error), true);
    }

    expect(ctrl.mode).toBe("suspended");
    expect(ctrl.canMakeLLMCalls()).toBe(false);
  });

  it("transient error → ModeController → observing after threshold", () => {
    const ctrl = new ModeController({ errorThreshold: 2 });

    ctrl.recordFailure("timeout", false);
    expect(ctrl.mode).toBe("active");

    ctrl.recordFailure("timeout again", false);
    expect(ctrl.mode).toBe("observing");
    expect(ctrl.canMakeLLMCalls()).toBe(false);
  });
});

describe("Full proposal lifecycle", () => {
  it("create → approve → pattern record → gossip", () => {
    const decisions: any[] = [];
    const pm = new ProposalManager({
      onDecision: (d) => decisions.push(d),
    });

    const proposal = {
      taskId: "task-123",
      summary: "Irrigate zone-1",
      operation: "irrigate",
      targetRef: "actuator:pump-01",
      status: "awaiting_approval" as const,
      createdAt: Date.now(),
      reasoning: "Moisture below 20%",
    } as TaskProposal;

    pm.add(proposal);
    const result = pm.approve("task-123", "farmer");

    expect(result).not.toBeNull();
    expect(decisions).toHaveLength(1);
    expect(decisions[0].approved).toBe(true);

    // Gossip the learned pattern
    const gossipFrame = buildPatternGossipFrame([{
      triggerCondition: decisions[0].triggerCondition,
      action: decisions[0].action,
      confidence: 0.6,
      approvalCount: 1,
      rejectionCount: 0,
    }]);

    expect(gossipFrame.kind).toBe("capability_update");
    expect(gossipFrame.data.patterns).toHaveLength(1);
  });
});

describe("Full pattern import pipeline", () => {
  it("remote pattern frame → isPatternFrame → extractPatterns", () => {
    const frame = makeFrame({
      kind: "capability_update",
      data: {
        type: "learned_patterns",
        patterns: [
          { triggerCondition: "moisture < 15%", action: { operation: "irrigate", targetRef: "pump-01" } },
        ],
      },
    });

    expect(isPatternFrame(frame)).toBe(true);
    const patterns = extractPatterns(frame);
    expect(patterns).toHaveLength(1);
  });
});

describe("System prompt + citations pipeline", () => {
  it("buildPlannerSystemPrompt + extractCitations", () => {
    const prompt = buildPlannerSystemPrompt({
      nodeName: "farm-hub",
      farmContext: {
        siteName: "Test Farm",
        zones: [{ zoneId: "z1", name: "Zone 1" }],
        assets: [],
        safetyRules: ["Never irrigate in rain"],
        operations: [],
      },
    });
    expect(prompt).toContain("farm-hub");
    expect(prompt).toContain("Test Farm");

    const frames = [
      makeFrame({ data: { metric: "soil_moisture", value: 12, zone: "z1" } }),
    ];
    const citations = extractCitations(frames);
    expect(citations).toHaveLength(1);
    expect(citations[0].metric).toBe("soil_moisture");
  });
});
