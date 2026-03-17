/**
 * Full pipeline validation tests — comprehensive end-to-end scenarios
 * testing the complete module graph from sensor input to LLM output.
 */

import { describe, it, expect } from "vitest";
import { ModeController } from "./mode-controller.js";
import { ProposalManager } from "./proposal-manager.js";
import { TriggerQueue } from "./trigger-queue.js";
import { ingestFrame, isPatternFrame, extractPatterns } from "./frame-ingestor.js";
import { buildOperatorPrompt, buildPlannerPrompt, cleanIntentText, extractCitations } from "./planner-prompt-builder.js";
import { buildPlannerSystemPrompt } from "./system-prompt-builder.js";
import { classifyEvent, extractAssistantText } from "./session-event-classifier.js";
import { hasAssistantContent, getLastMessage, findRecentProposalIds } from "./llm-response-helpers.js";
import { buildAgentResponseFrame, buildPatternGossipFrame, buildErrorResponse } from "./broadcast-helpers.js";
import { isPermanentLLMError } from "./threshold-checker.js";
import type { ContextFrame } from "../mesh/context-types.js";
import type { ThresholdRule, TaskProposal } from "./types.js";

function makeFrame(overrides?: Partial<ContextFrame>): ContextFrame {
  return {
    kind: "observation", frameId: `f-${Date.now()}`, sourceDeviceId: "s1",
    timestamp: Date.now(), data: { metric: "soil_moisture", value: 12, zone: "z1" },
    trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    ...overrides,
  };
}

describe("Scenario: Normal planner cycle with successful LLM response", () => {
  it("processes threshold breach to proposal creation", () => {
    // 1. Sensor frame arrives
    const frame = makeFrame({ data: { metric: "soil_moisture", value: 8, zone: "zone-1" } });

    // 2. FrameIngestor detects breach
    const rules: ThresholdRule[] = [{
      ruleId: "dry-alert", metric: "soil_moisture", belowThreshold: 15,
      promptHint: "Soil too dry", cooldownMs: 0,
    }];
    const result = ingestFrame(frame, rules, new Map());
    expect(result.breaches).toHaveLength(1);

    // 3. Queue the breach
    const queue = new TriggerQueue();
    queue.enqueueThresholdBreach({
      ruleId: result.breaches[0].ruleId,
      promptHint: result.breaches[0].promptHint,
      metric: result.breaches[0].metric,
      zone: result.breaches[0].zone,
      frame,
    });

    // 4. Mode check allows LLM calls
    const ctrl = new ModeController();
    expect(ctrl.canMakeLLMCalls()).toBe(true);

    // 5. Build planner prompt
    const { systemTriggers } = queue.drain();
    const prompt = buildPlannerPrompt(systemTriggers);
    expect(prompt).toContain("dry-alert");

    // 6. Simulate LLM response
    const llmResponse = {
      role: "assistant",
      content: [{ type: "text", text: "Zone-1 moisture at 8%. Proposing irrigation." }],
    };
    expect(hasAssistantContent(llmResponse)).toBe(true);
    ctrl.recordSuccess();

    // 7. Create proposal
    const pm = new ProposalManager();
    const proposal: TaskProposal = {
      taskId: "task-abc", summary: "Irrigate zone-1", operation: "irrigate",
      targetRef: "actuator:pump:P1", status: "awaiting_approval",
      createdAt: Date.now(), reasoning: "Moisture at 8%",
    } as TaskProposal;
    pm.add(proposal);
    expect(pm.countPending()).toBe(1);

    // 8. Build response frame
    const responseFrame = buildAgentResponseFrame(
      { message: "Proposing irrigation for zone-1", status: "complete", proposals: ["task-abc"] },
      "hub-01", "Farm Hub",
    );
    expect(responseFrame.data.proposals).toContain("task-abc");
  });
});

describe("Scenario: Operator chat with degraded mode", () => {
  it("queues intent during observing mode, processes on resume", () => {
    const ctrl = new ModeController({ errorThreshold: 1 });
    const queue = new TriggerQueue();

    // 1. Enter observing mode
    ctrl.recordFailure("rate limit", false);
    expect(ctrl.mode).toBe("observing");

    // 2. Operator intent arrives but can't be processed
    expect(ctrl.canMakeLLMCalls()).toBe(false);
    queue.enqueueIntent("check zone-1 status", { conversationId: "conv-1" });
    expect(queue.isEmpty).toBe(false);

    // 3. Resume
    ctrl.resume("probe succeeded");
    expect(ctrl.canMakeLLMCalls()).toBe(true);

    // 4. Process queued intent
    const { operatorIntents } = queue.drain();
    expect(operatorIntents).toHaveLength(1);
    const prompt = buildOperatorPrompt(
      cleanIntentText(operatorIntents[0].reason), [], [],
    );
    expect(prompt).toContain("check zone-1 status");
  });
});

describe("Scenario: Pattern learning across mesh", () => {
  it("learns from operator decisions and gossips to peers", () => {
    const decisions: any[] = [];
    const pm = new ProposalManager({
      onDecision: (d) => decisions.push(d),
    });

    // 1. Create and approve proposal
    pm.add({
      taskId: "t1", summary: "Irrigate z1", operation: "irrigate",
      targetRef: "pump-01", status: "awaiting_approval",
      createdAt: Date.now(), reasoning: "Dry soil",
    } as TaskProposal);
    pm.approve("t1");
    expect(decisions).toHaveLength(1);

    // 2. Build gossip frame
    const gossip = buildPatternGossipFrame([{
      triggerCondition: decisions[0].triggerCondition,
      action: decisions[0].action,
      confidence: 0.7,
      approvalCount: 1,
      rejectionCount: 0,
    }]);

    // 3. Remote peer receives and imports
    const remoteFrame = makeFrame({
      kind: "capability_update",
      data: gossip.data,
    });
    expect(isPatternFrame(remoteFrame)).toBe(true);
    const patterns = extractPatterns(remoteFrame);
    expect(patterns).toHaveLength(1);
  });
});

describe("Scenario: Session event handling", () => {
  it("classifies and routes all event types", () => {
    const events = [
      { type: "message_start", message: { role: "assistant", model: "claude-3" } },
      { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hello" }] } },
      { type: "tool_execution_start", toolName: "query", args: {} },
      { type: "tool_execution_end", toolName: "query", isError: true },
      { type: "auto_retry_start" },
      { type: "auto_compaction_start" },
      { type: "auto_compaction_end" },
      { type: "message_update" }, // skip
    ];

    const results = events.map(e => classifyEvent(e));
    expect(results[0].type).toBe("message_start");
    expect(results[1].type).toBe("assistant_text");
    expect(results[2].type).toBe("tool_start");
    expect(results[3].type).toBe("tool_error");
    expect(results[4].type).toBe("auto_retry");
    expect(results[5].type).toBe("compaction_start");
    expect(results[6].type).toBe("compaction_end");
    expect(results[7].type).toBe("skip");
  });
});
