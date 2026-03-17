/**
 * Tests for PiSession wiring of SessionEventClassifier and PlannerPromptBuilder.
 *
 * Validates that PiSession correctly delegates to:
 * - classifyEvent() for session event handling
 * - buildOperatorPrompt/buildPlannerPrompt for prompt construction
 * - extractCitations() for sensor citation building
 * - cleanIntentText() for intent envelope cleanup
 * - extractAssistantText() for response text extraction
 */

import { describe, it, expect } from "vitest";
import {
  classifyEvent,
  extractAssistantText,
  extractToolCallNames,
} from "./session-event-classifier.js";
import {
  buildOperatorPrompt,
  buildPlannerPrompt,
  cleanIntentText,
  extractCitations,
  parseModelSpec,
} from "./planner-prompt-builder.js";
import type { ContextFrame } from "../mesh/context-types.js";

function makeFrame(overrides?: Partial<ContextFrame>): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "sensor-01",
    timestamp: Date.now(),
    data: { metric: "soil_moisture", value: 42, zone: "zone-1" },
    trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    ...overrides,
  };
}

// ── SessionEventClassifier wiring ──────────────────────

describe("SessionEventClassifier wiring in PiSession.handleSessionEvent", () => {
  it("classifies message_start with model info", () => {
    const result = classifyEvent({
      type: "message_start",
      message: { role: "assistant", model: "claude-3" },
    });
    expect(result).toEqual({ type: "message_start", model: "claude-3" });
  });

  it("classifies message_end with assistant text → broadcasts inference", () => {
    const result = classifyEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Soil is dry in zone-1" }],
      },
    });
    expect(result.type).toBe("assistant_text");
    if (result.type === "assistant_text") {
      expect(result.text).toContain("Soil is dry");
    }
  });

  it("classifies message_end with error", () => {
    const result = classifyEvent({
      type: "message_end",
      message: { errorMessage: "rate limit exceeded" },
    });
    expect(result).toEqual({ type: "message_error", error: "rate limit exceeded" });
  });

  it("classifies tool_execution_start", () => {
    const result = classifyEvent({
      type: "tool_execution_start",
      toolName: "read_sensors",
      args: { zone: "zone-1" },
    });
    expect(result.type).toBe("tool_start");
    if (result.type === "tool_start") {
      expect(result.name).toBe("read_sensors");
    }
  });

  it("classifies tool_execution_end with error", () => {
    const result = classifyEvent({
      type: "tool_execution_end",
      toolName: "actuate",
      isError: true,
    });
    expect(result).toEqual({ type: "tool_error", name: "actuate" });
  });

  it("skips message_update (high-frequency streaming)", () => {
    expect(classifyEvent({ type: "message_update" })).toEqual({ type: "skip" });
  });

  it("classifies auto_retry and compaction events", () => {
    expect(classifyEvent({ type: "auto_retry_start" })).toEqual({ type: "auto_retry" });
    expect(classifyEvent({ type: "auto_compaction_start" })).toEqual({ type: "compaction_start" });
    expect(classifyEvent({ type: "auto_compaction_end" })).toEqual({ type: "compaction_end" });
  });

  it("skips unknown event types", () => {
    expect(classifyEvent({ type: "agent_start" })).toEqual({ type: "skip" });
    expect(classifyEvent({ type: "turn_end" })).toEqual({ type: "skip" });
  });
});

// ── extractAssistantText wiring ────────────────────────

describe("extractAssistantText wiring in runCycle response handling", () => {
  it("extracts and joins assistant text blocks", () => {
    const text = extractAssistantText({
      role: "assistant",
      content: [
        { type: "text", text: "First paragraph." },
        { type: "text", text: "Second paragraph." },
      ],
    });
    expect(text).toBe("First paragraph.\n\nSecond paragraph.");
  });

  it("returns null for non-assistant messages", () => {
    expect(extractAssistantText({ role: "user", content: [{ type: "text", text: "hi" }] })).toBeNull();
  });

  it("returns null for empty text blocks", () => {
    expect(extractAssistantText({ role: "assistant", content: [{ type: "text", text: "  " }] })).toBeNull();
  });

  it("extracts tool call names", () => {
    const names = extractToolCallNames({
      content: [
        { type: "toolCall", name: "read_sensors" },
        { type: "toolCall", name: "propose_task" },
      ],
    });
    expect(names).toEqual(["read_sensors", "propose_task"]);
  });
});

// ── PlannerPromptBuilder wiring ────────────────────────

describe("PlannerPromptBuilder wiring in runCycle", () => {
  it("buildOperatorPrompt includes intent and system triggers", () => {
    const prompt = buildOperatorPrompt(
      "check zone-1",
      [{ reason: "moisture low", priority: 1 }],
      [],
    );
    expect(prompt).toContain("[OPERATOR MESSAGE]");
    expect(prompt).toContain("check zone-1");
    expect(prompt).toContain("moisture low");
  });

  it("buildOperatorPrompt includes learned patterns", () => {
    const prompt = buildOperatorPrompt("irrigate", [], [
      {
        triggerCondition: "moisture below 20%",
        action: { operation: "irrigate", targetRef: "pump-01" },
        confidence: 0.85,
        approvalCount: 5,
        rejectionCount: 1,
      },
    ]);
    expect(prompt).toContain("LEARNED PATTERNS");
    expect(prompt).toContain("85%");
    expect(prompt).toContain("approved 5x");
  });

  it("buildOperatorPrompt without triggers or patterns is clean", () => {
    const prompt = buildOperatorPrompt("status check", [], []);
    expect(prompt).toContain("status check");
    expect(prompt).not.toContain("system triggers");
    expect(prompt).not.toContain("LEARNED PATTERNS");
  });

  it("buildPlannerPrompt formats system triggers", () => {
    const prompt = buildPlannerPrompt([
      { reason: "moisture-critical breach", priority: 1 },
      { reason: "proactive check", priority: 3 },
    ]);
    expect(prompt).toContain("[PLANNER CYCLE");
    expect(prompt).toContain("moisture-critical breach");
    expect(prompt).toContain("proactive check");
  });

  it("cleanIntentText strips operator_intent envelope", () => {
    expect(cleanIntentText('operator_intent: "irrigate zone-1"')).toBe("irrigate zone-1");
    expect(cleanIntentText("check status")).toBe("check status");
  });
});

// ── extractCitations wiring ────────────────────────────

describe("extractCitations wiring in runCycle response", () => {
  it("extracts citations from observation frames", () => {
    const frames = [
      makeFrame({ data: { metric: "soil_moisture", value: 12, zone: "zone-1" } }),
      makeFrame({ data: { metric: "temperature", value: 35, zone: "zone-2" } }),
      makeFrame({ kind: "inference", data: { reasoning: "skip me" } }),
    ];
    const citations = extractCitations(frames);
    expect(citations).toHaveLength(2);
    expect(citations[0].metric).toBe("soil_moisture");
    expect(citations[1].metric).toBe("temperature");
  });

  it("limits citation count", () => {
    const frames = Array.from({ length: 20 }, (_, i) =>
      makeFrame({ data: { metric: `m${i}`, value: i, zone: "z1" } }),
    );
    expect(extractCitations(frames, 3)).toHaveLength(3);
  });

  it("returns empty for non-observation frames", () => {
    const frames = [makeFrame({ kind: "inference", data: { reasoning: "test" } })];
    expect(extractCitations(frames)).toHaveLength(0);
  });
});
