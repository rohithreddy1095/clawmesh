/**
 * Session 5 milestone tests — push to 1900.
 *
 * Additional edge cases and boundary conditions for the wired modules.
 */

import { describe, it, expect } from "vitest";
import { ModeController } from "./mode-controller.js";
import { ProposalManager } from "./proposal-manager.js";
import { TriggerQueue } from "./trigger-queue.js";
import { hasAssistantContent } from "./llm-response-helpers.js";
import { cleanIntentText, parseModelSpec, extractCitations } from "./planner-prompt-builder.js";
import { buildAgentResponseFrame } from "./broadcast-helpers.js";
import type { ContextFrame } from "../mesh/context-types.js";
import type { TaskProposal } from "./types.js";

function makeFrame(overrides?: Partial<ContextFrame>): ContextFrame {
  return {
    kind: "observation", frameId: `f-${Date.now()}`, sourceDeviceId: "s1",
    timestamp: Date.now(), data: { metric: "m", value: 1, zone: "z1" },
    trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    ...overrides,
  };
}

describe("ModeController milestone edge cases", () => {
  it("multiple resumes are idempotent", () => {
    const ctrl = new ModeController();
    ctrl.resume();
    ctrl.resume();
    ctrl.resume();
    expect(ctrl.mode).toBe("active");
  });

  it("permanent error trumps error threshold", () => {
    const ctrl = new ModeController({ errorThreshold: 100 });
    // Even with high threshold, permanent error suspends immediately
    ctrl.recordFailure("403", true);
    expect(ctrl.mode).toBe("suspended");
    expect(ctrl.consecutiveErrors).toBe(1);
  });
});

describe("TriggerQueue milestone edge cases", () => {
  it("drain empty queue returns empty arrays", () => {
    const q = new TriggerQueue();
    const { operatorIntents, systemTriggers } = q.drain();
    expect(operatorIntents).toHaveLength(0);
    expect(systemTriggers).toHaveLength(0);
  });

  it("multiple drains without enqueue are safe", () => {
    const q = new TriggerQueue();
    q.drain();
    q.drain();
    q.drain();
    expect(q.isEmpty).toBe(true);
  });
});

describe("hasAssistantContent comprehensive", () => {
  it("text with newlines only is falsy", () => {
    expect(hasAssistantContent({ role: "assistant", content: [{ type: "text", text: "\n\n\n" }] })).toBe(false);
  });

  it("text with tabs only is falsy", () => {
    expect(hasAssistantContent({ role: "assistant", content: [{ type: "text", text: "\t\t" }] })).toBe(false);
  });

  it("mixed empty text and valid tool call is truthy", () => {
    expect(hasAssistantContent({
      role: "assistant",
      content: [
        { type: "text", text: "" },
        { type: "toolCall", name: "read_sensors" },
      ],
    })).toBe(true);
  });
});

describe("cleanIntentText comprehensive", () => {
  it("preserves special characters", () => {
    expect(cleanIntentText("check zone-1 (50% capacity)")).toBe("check zone-1 (50% capacity)");
  });

  it("handles multiline input", () => {
    expect(cleanIntentText("line1\nline2")).toBe("line1\nline2");
  });
});

describe("extractCitations comprehensive", () => {
  it("skips frames without metric field", () => {
    const frames = [
      makeFrame({ kind: "observation", data: { value: 42, zone: "z1" } }), // no metric
      makeFrame({ kind: "observation", data: { metric: "temp", value: 30 } }),
    ];
    const citations = extractCitations(frames);
    expect(citations).toHaveLength(1);
    expect(citations[0].metric).toBe("temp");
  });
});

describe("buildAgentResponseFrame comprehensive", () => {
  it("handles missing optional fields", () => {
    const frame = buildAgentResponseFrame(
      { message: "test", status: "complete" },
      "dev-1", "hub",
    );
    expect(frame.data.conversationId).toBeUndefined();
    expect(frame.data.proposals).toBeUndefined();
    expect(frame.data.citations).toBeUndefined();
  });
});

describe("parseModelSpec comprehensive", () => {
  it("handles provider with numbers", () => {
    const { provider, modelId } = parseModelSpec("azure-openai/gpt-4o");
    expect(provider).toBe("azure-openai");
    expect(modelId).toBe("gpt-4o");
  });
});
