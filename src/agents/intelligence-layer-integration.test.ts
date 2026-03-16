import { describe, it, expect } from "vitest";
import { ModeController } from "./mode-controller.js";
import { ProposalManager } from "./proposal-manager.js";
import {
  buildOperatorPrompt,
  buildPlannerPrompt,
  extractCitations,
  cleanIntentText,
  parseModelSpec,
} from "./planner-prompt-builder.js";
import { classifyEvent, extractAssistantText, extractToolCallNames } from "./session-event-classifier.js";
import type { ContextFrame } from "../mesh/context-types.js";
import type { TaskProposal } from "./types.js";

// ─── helpers ────────────────────────────────────────

function makeFrame(overrides: Partial<ContextFrame> = {}): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "device-abc",
    timestamp: Date.now(),
    data: { metric: "moisture", value: 42, zone: "zone-1" },
    trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T1_unverified_observation" },
    ...overrides,
  };
}

function makeProposal(overrides: Partial<TaskProposal> = {}): TaskProposal {
  return {
    taskId: `task-${Math.random().toString(36).slice(2, 10)}`,
    summary: "Start pump P1",
    reasoning: "Moisture below 20%",
    targetRef: "actuator:pump:P1",
    operation: "start",
    peerDeviceId: "peer-abc",
    approvalLevel: "L2",
    status: "awaiting_approval",
    createdBy: "intelligence",
    triggerFrameIds: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

// ─── ModeController integration edge cases ──────────

describe("ModeController - advanced scenarios", () => {
  it("rapid failure then success cycle", () => {
    const mc = new ModeController({ errorThreshold: 2 });
    mc.recordFailure("e1", false);
    mc.recordFailure("e2", false);
    expect(mc.mode).toBe("observing");
    mc.recordSuccess();
    expect(mc.mode).toBe("active");
    mc.recordFailure("e3", false);
    expect(mc.mode).toBe("active");
    expect(mc.consecutiveErrors).toBe(1);
  });

  it("suspend during observing then resume", () => {
    const mc = new ModeController({ errorThreshold: 1 });
    mc.recordFailure("e1", false);
    expect(mc.mode).toBe("observing");
    mc.recordFailure("403", true);
    expect(mc.mode).toBe("suspended");
    mc.resume("manual");
    expect(mc.mode).toBe("active");
    expect(mc.consecutiveErrors).toBe(0);
  });

  it("observing cooldown is configurable and reported", () => {
    const mc = new ModeController({ observingCooldownMs: 60_000 });
    expect(mc.observingCooldownMs).toBe(60_000);
  });

  it("getStatus tracks errors through transitions", () => {
    const mc = new ModeController({ errorThreshold: 2 });
    mc.recordFailure("e1", false);
    let status = mc.getStatus();
    expect(status.mode).toBe("active");
    expect(status.consecutiveErrors).toBe(1);
    mc.recordFailure("e2", false);
    status = mc.getStatus();
    expect(status.mode).toBe("observing");
    expect(status.consecutiveErrors).toBe(2);
  });
});

// ─── ProposalManager interaction patterns ───────────

describe("ProposalManager - interaction patterns", () => {
  it("workflow: add → approve → complete", () => {
    const pm = new ProposalManager();
    const p = makeProposal({ taskId: "t1" });
    pm.add(p);
    pm.approve("t1");
    expect(p.status).toBe("approved");
    pm.complete("t1", { ok: true });
    expect(p.status).toBe("completed");
    expect(p.resolvedAt).toBeGreaterThan(0);
  });

  it("workflow: add → reject (no complete needed)", () => {
    const pm = new ProposalManager();
    pm.add(makeProposal({ taskId: "t1" }));
    pm.reject("t1");
    expect(pm.get("t1")?.status).toBe("rejected");
  });

  it("mixed status proposals filter correctly", () => {
    const pm = new ProposalManager();
    pm.add(makeProposal({ taskId: "a", status: "awaiting_approval" }));
    pm.add(makeProposal({ taskId: "b", status: "executing" }));
    pm.add(makeProposal({ taskId: "c", status: "completed" }));
    pm.add(makeProposal({ taskId: "d", status: "failed" }));
    pm.add(makeProposal({ taskId: "e", status: "proposed" }));
    expect(pm.countPending()).toBe(2);
    expect(pm.list({ status: "executing" })).toHaveLength(1);
  });

  it("complete with error sets correct status", () => {
    const pm = new ProposalManager();
    pm.add(makeProposal({ taskId: "t1", status: "executing" }));
    pm.complete("t1", { ok: false, error: "peer disconnected" });
    const p = pm.get("t1");
    expect(p?.status).toBe("failed");
    expect(p?.result?.error).toBe("peer disconnected");
  });
});

// ─── Prompt builder edge cases ──────────────────────

describe("PlannerPromptBuilder - edge cases", () => {
  it("buildOperatorPrompt with both triggers and patterns", () => {
    const result = buildOperatorPrompt(
      "check moisture",
      [{ reason: "moisture breach zone-1", priority: 2 }],
      [{
        triggerCondition: "moisture < 15%",
        action: { operation: "start", targetRef: "actuator:pump:P1" },
        confidence: 0.9,
        approvalCount: 3,
        rejectionCount: 0,
      }],
    );
    expect(result).toContain("check moisture");
    expect(result).toContain("moisture breach zone-1");
    expect(result).toContain("moisture < 15%");
    expect(result).toContain("90%");
  });

  it("extractCitations handles mixed frame kinds", () => {
    const frames = [
      makeFrame({ kind: "observation", data: { metric: "temp", value: 30 } }),
      makeFrame({ kind: "event", data: { metric: "pump", value: "on" } }),
      makeFrame({ kind: "inference", data: { reasoning: "test" } }),
      makeFrame({ kind: "observation", data: { metric: "humidity", value: 65 } }),
    ];
    const citations = extractCitations(frames);
    expect(citations).toHaveLength(2);
    expect(citations[0].metric).toBe("temp");
    expect(citations[1].metric).toBe("humidity");
  });

  it("parseModelSpec with complex provider paths", () => {
    expect(parseModelSpec("azure/gpt-4/2024-01")).toEqual({
      provider: "azure",
      modelId: "gpt-4/2024-01",
    });
  });

  it("cleanIntentText with nested quotes", () => {
    expect(cleanIntentText('operator_intent: "what\'s the status"'))
      .toBe("what's the status");
  });
});

// ─── SessionEventClassifier edge cases ──────────────

describe("SessionEventClassifier - edge cases", () => {
  it("handles message_end with null content", () => {
    expect(classifyEvent({
      type: "message_end",
      message: { role: "assistant", content: null },
    })).toEqual({ type: "skip" });
  });

  it("handles mixed text and tool content", () => {
    // Text takes priority
    const result = classifyEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Here are the results" },
          { type: "toolCall", name: "query_world_model" },
        ],
      },
    });
    expect(result.type).toBe("assistant_text");
  });

  it("extractAssistantText with single block", () => {
    const text = extractAssistantText({
      role: "assistant",
      content: [{ type: "text", text: "Single block" }],
    });
    expect(text).toBe("Single block");
  });

  it("extractToolCallNames with non-array content", () => {
    expect(extractToolCallNames({ content: "not an array" })).toEqual([]);
  });

  it("classifyEvent handles null event message", () => {
    expect(classifyEvent({ type: "message_end", message: null })).toEqual({ type: "skip" });
  });

  it("classifyEvent handles tool_execution_start with no args", () => {
    const result = classifyEvent({ type: "tool_execution_start", toolName: "test" });
    expect(result).toEqual({ type: "tool_start", name: "test", args: "{}" });
  });
});

// ─── Cross-module scenarios ─────────────────────────

describe("Intelligence layer integration", () => {
  it("mode controller → proposal manager gating", () => {
    const mc = new ModeController({ errorThreshold: 2 });
    const pm = new ProposalManager();
    pm.add(makeProposal({ taskId: "t1" }));

    // Simulate: mode check before processing proposals
    mc.recordFailure("e1", false);
    mc.recordFailure("e2", false);
    expect(mc.canMakeLLMCalls()).toBe(false);

    // Proposals accumulate but can't be processed
    expect(pm.countPending()).toBe(1);

    // Resume and process
    mc.resume();
    expect(mc.canMakeLLMCalls()).toBe(true);
    pm.approve("t1");
    pm.complete("t1", { ok: true });
    expect(pm.get("t1")?.status).toBe("completed");
  });

  it("citations from world model frames feed into prompts", () => {
    const frames = [
      makeFrame({ data: { metric: "moisture", value: 18, zone: "zone-1", unit: "%" } }),
      makeFrame({ data: { metric: "temp", value: 32, zone: "zone-2", unit: "°C" } }),
    ];
    const citations = extractCitations(frames);
    const prompt = buildOperatorPrompt(
      "should I irrigate?",
      [{ reason: `moisture=${citations[0].value}% < threshold`, priority: 2 }],
      [],
    );
    expect(prompt).toContain("should I irrigate");
    expect(prompt).toContain("moisture=18%");
  });

  it("event classifier identifies LLM response for broadcasting", () => {
    const event = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Based on sensor data, moisture in zone-1 is at 18%. I recommend irrigation." },
        ],
      },
    };
    const classified = classifyEvent(event);
    expect(classified.type).toBe("assistant_text");
    if (classified.type === "assistant_text") {
      expect(classified.text).toContain("moisture in zone-1");
    }
  });
});
