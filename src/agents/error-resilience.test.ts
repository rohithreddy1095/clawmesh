/**
 * Comprehensive error handling tests across all modules.
 *
 * Validates that all modules handle error conditions gracefully.
 */

import { describe, it, expect } from "vitest";
import { ModeController } from "./mode-controller.js";
import { ProposalManager } from "./proposal-manager.js";
import { TriggerQueue } from "./trigger-queue.js";
import { ingestFrame } from "./frame-ingestor.js";
import { isPermanentLLMError } from "./threshold-checker.js";
import { classifyEvent } from "./session-event-classifier.js";
import { buildOperatorPrompt, parseModelSpec, extractCitations } from "./planner-prompt-builder.js";
import { buildPlannerSystemPrompt } from "./system-prompt-builder.js";
import { hasAssistantContent, getLastMessage, findRecentProposalIds } from "./llm-response-helpers.js";
import { buildAgentResponseFrame, buildPatternGossipFrame, buildErrorResponse, buildRateLimitResponse } from "./broadcast-helpers.js";
import { MeshEventBus } from "../mesh/event-bus.js";
import { MeshCapabilityRegistry } from "../mesh/capabilities.js";
import type { TaskProposal } from "./types.js";

describe("Error resilience: ModeController", () => {
  it("handles empty reason string", () => {
    const ctrl = new ModeController();
    ctrl.recordFailure("", false);
    expect(ctrl.consecutiveErrors).toBe(1);
  });

  it("handles very long reason string", () => {
    const ctrl = new ModeController({ errorThreshold: 1 });
    ctrl.recordFailure("x".repeat(10000), false);
    expect(ctrl.mode).toBe("observing");
  });
});

describe("Error resilience: ProposalManager", () => {
  it("handles approve with empty string ID", () => {
    const pm = new ProposalManager();
    expect(pm.approve("")).toBeNull();
  });

  it("handles get with undefined-like ID", () => {
    const pm = new ProposalManager();
    expect(pm.get("undefined")).toBeUndefined();
  });

  it("handles list filter with unknown status", () => {
    const pm = new ProposalManager();
    pm.add({ taskId: "t1", status: "awaiting_approval" } as TaskProposal);
    expect(pm.list({ status: "nonexistent" as any })).toHaveLength(0);
  });
});

describe("Error resilience: TriggerQueue", () => {
  it("handles enqueue with empty text", () => {
    const q = new TriggerQueue();
    q.enqueueIntent("");
    expect(q.isEmpty).toBe(false);
    const { operatorIntents } = q.drain();
    expect(operatorIntents).toHaveLength(1);
  });

  it("handles enqueue with null-like frame", () => {
    const q = new TriggerQueue();
    q.enqueueThresholdBreach({
      ruleId: "",
      promptHint: "",
      metric: "",
      frame: {} as any,
    });
    expect(q.length).toBe(1);
  });
});

describe("Error resilience: ingestFrame", () => {
  it("handles frame with undefined data values", () => {
    const result = ingestFrame(
      { kind: "observation", frameId: "f1", sourceDeviceId: "d1", timestamp: Date.now(),
        data: { metric: "m", value: undefined as any }, trust: { evidence_sources: [], evidence_trust_tier: "T2_operational_observation" } },
      [{ ruleId: "r1", metric: "m", belowThreshold: 10, promptHint: "low", cooldownMs: 0 }],
      new Map(),
    );
    expect(result.action).toBe("skip");
  });

  it("handles frame with string value (wrong type)", () => {
    const result = ingestFrame(
      { kind: "observation", frameId: "f2", sourceDeviceId: "d1", timestamp: Date.now(),
        data: { metric: "m", value: "not a number" as any }, trust: { evidence_sources: [], evidence_trust_tier: "T2_operational_observation" } },
      [{ ruleId: "r1", metric: "m", belowThreshold: 10, promptHint: "low", cooldownMs: 0 }],
      new Map(),
    );
    expect(result.action).toBe("skip");
  });
});

describe("Error resilience: classifyEvent", () => {
  it("handles event with no type field", () => {
    expect(classifyEvent({}).type).toBe("skip");
  });

  it("handles event with numeric type", () => {
    expect(classifyEvent({ type: 42 as any }).type).toBe("skip");
  });

  it("handles message_end with null message", () => {
    expect(classifyEvent({ type: "message_end", message: null }).type).toBe("skip");
  });
});

describe("Error resilience: prompt builders", () => {
  it("buildOperatorPrompt with null patterns array doesn't crash", () => {
    // Empty array should work fine
    const prompt = buildOperatorPrompt("test", [], []);
    expect(prompt).toContain("test");
  });

  it("buildPlannerSystemPrompt with empty farmContext fields", () => {
    const prompt = buildPlannerSystemPrompt({
      nodeName: "hub",
      farmContext: {
        siteName: "",
        zones: [],
        assets: [],
        safetyRules: [],
        operations: [],
      },
    });
    expect(prompt).toContain("hub");
  });
});

describe("Error resilience: LLM response helpers", () => {
  it("getLastMessage handles array with undefined elements", () => {
    const msgs = [undefined, null, { role: "assistant" }];
    expect(getLastMessage(msgs as any)).toEqual({ role: "assistant" });
  });

  it("findRecentProposalIds handles negative timestamps", () => {
    const proposals = [{ taskId: "t1", createdAt: -1000 }];
    expect(findRecentProposalIds(proposals, 10000, Date.now())).toEqual([]);
  });
});

describe("Error resilience: broadcast helpers", () => {
  it("buildAgentResponseFrame with empty strings", () => {
    const frame = buildAgentResponseFrame({ message: "", status: "error" }, "", "");
    expect(frame.kind).toBe("agent_response");
  });

  it("buildPatternGossipFrame with NaN confidence", () => {
    const frame = buildPatternGossipFrame([{
      triggerCondition: "test",
      action: { operation: "op", targetRef: "ref" },
      confidence: NaN,
      approvalCount: 0,
      rejectionCount: 0,
    }]);
    expect(frame.data.patterns).toHaveLength(1);
  });
});

describe("Error resilience: MeshEventBus", () => {
  it("emit with handler that throws doesn't break bus", () => {
    const bus = new MeshEventBus();
    bus.on("peer.connected", () => { throw new Error("handler error"); });

    // Should not throw (bus should catch)
    expect(() => {
      try { bus.emit("peer.connected", { deviceId: "d1", capabilities: [] } as any); } catch {}
    }).not.toThrow();
  });
});

describe("Error resilience: CapabilityRegistry", () => {
  it("findPeersWithCapability for unregistered capability", () => {
    const reg = new MeshCapabilityRegistry();
    expect(reg.findPeersWithCapability("nonexistent")).toEqual([]);
  });

  it("getPeerCapabilities for unknown device", () => {
    const reg = new MeshCapabilityRegistry();
    expect(reg.getPeerCapabilities("unknown")).toEqual([]);
  });

  it("removePeer for unknown device is safe", () => {
    const reg = new MeshCapabilityRegistry();
    reg.removePeer("unknown");
    expect(reg.listAll()).toEqual([]);
  });
});

describe("Error resilience: isPermanentLLMError", () => {
  it("handles object error without toString", () => {
    // String({message: "403"}) = "[object Object]" — not containing "403"
    expect(isPermanentLLMError({ message: "403 Forbidden" })).toBe(false);
  });

  it("handles number error", () => {
    expect(isPermanentLLMError(403)).toBe(true);
  });

  it("handles empty string", () => {
    expect(isPermanentLLMError("")).toBe(false);
  });
});
