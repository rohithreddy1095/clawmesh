/**
 * Edge case tests for Session 5 extracted modules.
 *
 * Tests boundary conditions and edge cases across the newly
 * wired modules in PiSession.
 */

import { describe, it, expect } from "vitest";
import { ModeController } from "./mode-controller.js";
import { ProposalManager } from "./proposal-manager.js";
import { ingestFrame } from "./frame-ingestor.js";
import { isPermanentLLMError } from "./threshold-checker.js";
import { classifyEvent } from "./session-event-classifier.js";
import { buildOperatorPrompt, cleanIntentText, parseModelSpec } from "./planner-prompt-builder.js";
import { hasAssistantContent, findRecentProposalIds } from "./llm-response-helpers.js";
import { buildPatternGossipFrame, buildErrorResponse } from "./broadcast-helpers.js";
import type { TaskProposal } from "./types.js";

describe("ModeController edge cases", () => {
  it("multiple rapid failures exceed threshold", () => {
    const ctrl = new ModeController({ errorThreshold: 3 });
    for (let i = 0; i < 5; i++) ctrl.recordFailure(`err-${i}`, false);
    expect(ctrl.mode).toBe("observing");
    expect(ctrl.consecutiveErrors).toBe(5);
  });

  it("resume from observing clears all state", () => {
    const ctrl = new ModeController({ errorThreshold: 1 });
    ctrl.recordFailure("err", false);
    expect(ctrl.mode).toBe("observing");
    ctrl.resume("test");
    expect(ctrl.mode).toBe("active");
    expect(ctrl.consecutiveErrors).toBe(0);
  });

  it("recordSuccess from active is a no-op", () => {
    const ctrl = new ModeController();
    ctrl.recordSuccess();
    expect(ctrl.mode).toBe("active");
  });

  it("setMode returns false for same mode", () => {
    const ctrl = new ModeController();
    expect(ctrl.setMode("active", "test")).toBe(false);
  });

  it("setMode returns true for different mode", () => {
    const ctrl = new ModeController();
    expect(ctrl.setMode("observing", "test")).toBe(true);
  });
});

describe("ProposalManager edge cases", () => {
  it("approve non-existent proposal returns null", () => {
    const pm = new ProposalManager();
    expect(pm.approve("nonexistent")).toBeNull();
  });

  it("approve already-approved proposal returns null", () => {
    const pm = new ProposalManager();
    pm.add({ taskId: "t1", status: "approved" } as TaskProposal);
    expect(pm.approve("t1")).toBeNull();
  });

  it("reject completed proposal returns null", () => {
    const pm = new ProposalManager();
    pm.add({ taskId: "t1", status: "completed" } as TaskProposal);
    expect(pm.reject("t1")).toBeNull();
  });

  it("complete unknown proposal returns null", () => {
    const pm = new ProposalManager();
    expect(pm.complete("unknown", { ok: true })).toBeNull();
  });

  it("clear removes all proposals", () => {
    const pm = new ProposalManager();
    pm.add({ taskId: "t1" } as TaskProposal);
    pm.add({ taskId: "t2" } as TaskProposal);
    expect(pm.size).toBe(2);
    pm.clear();
    expect(pm.size).toBe(0);
  });
});

describe("isPermanentLLMError edge cases", () => {
  it("null error is not permanent", () => {
    expect(isPermanentLLMError(null)).toBe(false);
  });

  it("undefined error is not permanent", () => {
    expect(isPermanentLLMError(undefined)).toBe(false);
  });

  it("network error is not permanent", () => {
    expect(isPermanentLLMError(new Error("ECONNRESET"))).toBe(false);
  });

  it("terms of service is permanent", () => {
    expect(isPermanentLLMError(new Error("Violation of terms of service"))).toBe(true);
  });
});

describe("classifyEvent edge cases", () => {
  it("message_start without model returns skip", () => {
    expect(classifyEvent({ type: "message_start", message: { role: "user" } }).type).toBe("skip");
  });

  it("message_end with no message returns skip", () => {
    expect(classifyEvent({ type: "message_end" }).type).toBe("skip");
  });

  it("tool_execution_end without error returns skip", () => {
    expect(classifyEvent({ type: "tool_execution_end", isError: false }).type).toBe("skip");
  });
});

describe("buildOperatorPrompt edge cases", () => {
  it("empty intent text", () => {
    const prompt = buildOperatorPrompt("", [], []);
    expect(prompt).toContain('[OPERATOR MESSAGE] ""');
  });

  it("10 patterns are included (max)", () => {
    const patterns = Array.from({ length: 15 }, (_, i) => ({
      triggerCondition: `cond-${i}`,
      action: { operation: "op", targetRef: `ref-${i}` },
      confidence: 0.5,
      approvalCount: 1,
      rejectionCount: 0,
    }));
    const prompt = buildOperatorPrompt("test", [], patterns);
    // Only first 10 should appear
    expect(prompt).toContain("cond-9");
    expect(prompt).not.toContain("cond-10");
  });
});

describe("cleanIntentText edge cases", () => {
  it("already clean text passes through", () => {
    expect(cleanIntentText("hello")).toBe("hello");
  });

  it("strips operator_intent prefix with quotes", () => {
    expect(cleanIntentText('operator_intent: "check"')).toBe("check");
  });

  it("handles empty string", () => {
    expect(cleanIntentText("")).toBe("");
  });
});

describe("hasAssistantContent edge cases", () => {
  it("non-array content returns false", () => {
    expect(hasAssistantContent({ role: "assistant", content: "text" })).toBe(false);
  });

  it("only whitespace text returns false", () => {
    expect(hasAssistantContent({
      role: "assistant",
      content: [{ type: "text", text: "\n\t  " }],
    })).toBe(false);
  });
});

describe("findRecentProposalIds edge cases", () => {
  it("proposals exactly at boundary", () => {
    const now = 1000000;
    const proposals = [{ taskId: "t1", createdAt: now - 10000 }];
    // Exactly at boundary — createdAt >= now - window
    expect(findRecentProposalIds(proposals, 10000, now)).toEqual(["t1"]);
  });

  it("proposals just outside boundary", () => {
    const now = 1000000;
    const proposals = [{ taskId: "t1", createdAt: now - 10001 }];
    expect(findRecentProposalIds(proposals, 10000, now)).toEqual([]);
  });
});

describe("buildPatternGossipFrame edge cases", () => {
  it("single pattern with zero confidence", () => {
    const frame = buildPatternGossipFrame([{
      triggerCondition: "test",
      action: { operation: "op", targetRef: "ref" },
      confidence: 0,
      approvalCount: 0,
      rejectionCount: 5,
    }]);
    expect(frame.data.patterns[0].confidence).toBe(0);
  });
});

describe("parseModelSpec edge cases", () => {
  it("multiple slashes preserved in model ID", () => {
    const result = parseModelSpec("google/gemini-2.0/flash");
    expect(result.provider).toBe("google");
    expect(result.modelId).toBe("gemini-2.0/flash");
  });
});

describe("ingestFrame edge cases", () => {
  it("non-observation frame with rules returns skip", () => {
    const result = ingestFrame(
      { kind: "event", frameId: "f1", sourceDeviceId: "d1", timestamp: Date.now(),
        data: { event: "test" }, trust: { evidence_sources: [], evidence_trust_tier: "T0_planning_inference" } },
      [{ ruleId: "r1", metric: "m", belowThreshold: 10, promptHint: "low", cooldownMs: 0 }],
      new Map(),
    );
    expect(result.action).toBe("skip");
  });

  it("empty rules array returns skip", () => {
    const result = ingestFrame(
      { kind: "observation", frameId: "f1", sourceDeviceId: "d1", timestamp: Date.now(),
        data: { metric: "m", value: 5 }, trust: { evidence_sources: [], evidence_trust_tier: "T2_operational_observation" } },
      [],
      new Map(),
    );
    expect(result.action).toBe("skip");
  });
});
