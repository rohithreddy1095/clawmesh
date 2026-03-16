import { describe, it, expect } from "vitest";
import {
  formatFrames,
  findPeerForCapability,
  summarizeProposals,
  countPending,
  fmtUptime,
  compactDataSummary,
} from "./extensions/mesh-extension-helpers.js";
import { ModeController } from "./mode-controller.js";
import { ProposalManager } from "./proposal-manager.js";
import { extractCitations, parseModelSpec, cleanIntentText } from "./planner-prompt-builder.js";
import { classifyEvent } from "./session-event-classifier.js";
import type { ContextFrame } from "../mesh/context-types.js";
import type { TaskProposal } from "./types.js";

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

// ─── 1000-test milestone: comprehensive edge cases ──

describe("formatFrames - additional edge cases", () => {
  it("handles frame with complex nested data", () => {
    const frame = makeFrame({
      data: { metric: "test", nested: { deep: { value: 42 } } },
      sourceDisplayName: "Node-X",
    });
    const result = formatFrames([frame]);
    expect(result).toContain("Node-X");
    expect(result).toContain("42");
  });

  it("handles frame with numeric sourceDeviceId prefix", () => {
    const frame = makeFrame({ sourceDeviceId: "123456789012345" });
    delete (frame as any).sourceDisplayName;
    const result = formatFrames([frame]);
    expect(result).toContain("123456789012...");
  });
});

describe("findPeerForCapability - edge cases", () => {
  it("handles empty ref string", () => {
    const finder = () => [] as string[];
    expect(findPeerForCapability(finder, "")).toBeNull();
  });

  it("handles ref with many segments", () => {
    const finder = (ref: string) =>
      ref === "sensor:moisture:zone-1:deep:sub" ? ["peer-x"] : [];
    expect(findPeerForCapability(finder, "sensor:moisture:zone-1:deep:sub")).toBe("peer-x");
  });
});

describe("compactDataSummary - edge cases", () => {
  it("handles value=0", () => {
    expect(compactDataSummary({ zone: "z1", metric: "level", value: 0 }))
      .toBe("z1 level=0");
  });

  it("handles empty object", () => {
    expect(compactDataSummary({})).toBe("{}");
  });

  it("handles zone+metric but undefined value", () => {
    // value is undefined, so the zone+metric+value path doesn't match
    const result = compactDataSummary({ zone: "z1", metric: "temp" });
    expect(result).toContain("zone");
  });
});

describe("fmtUptime - boundary values", () => {
  it("exactly 1 hour", () => {
    expect(fmtUptime(3_600_000)).toBe("1h00m");
  });

  it("59 minutes 59 seconds", () => {
    expect(fmtUptime(3_599_000)).toBe("59m59s");
  });

  it("sub-second (rounds to 0s)", () => {
    expect(fmtUptime(500)).toBe("0m00s");
  });
});

describe("ModeController - boundary conditions", () => {
  it("errorThreshold=0 always goes to observing", () => {
    // Edge case: threshold 0 means any error triggers observing
    // But actually errorThreshold >= consecutiveErrors, so with threshold=0,
    // even 1 error (>=0) triggers observing
    const mc = new ModeController({ errorThreshold: 0 });
    mc.recordFailure("any", false);
    expect(mc.mode).toBe("observing");
  });

  it("resume from active is no-op on mode but resets counters", () => {
    const mc = new ModeController({ errorThreshold: 10 });
    mc.recordFailure("e1", false);
    mc.recordFailure("e2", false);
    expect(mc.consecutiveErrors).toBe(2);
    mc.resume();
    expect(mc.mode).toBe("active"); // was already active
    expect(mc.consecutiveErrors).toBe(0);
  });
});

describe("ProposalManager - boundary cases", () => {
  it("findByPrefix with empty string matches first proposal", () => {
    const pm = new ProposalManager();
    const p = makeProposal({ taskId: "abc" });
    pm.add(p);
    // Empty string matches everything
    expect(pm.findByPrefix("")).toBe(p);
  });

  it("list with undefined filter returns all", () => {
    const pm = new ProposalManager();
    pm.add(makeProposal({ taskId: "a" }));
    pm.add(makeProposal({ taskId: "b" }));
    expect(pm.list(undefined)).toHaveLength(2);
    expect(pm.list()).toHaveLength(2);
  });

  it("complete on already-completed proposal overwrites status", () => {
    const pm = new ProposalManager();
    const p = makeProposal({ taskId: "t1", status: "completed" });
    pm.add(p);
    pm.complete("t1", { ok: false, error: "retry failed" });
    expect(p.status).toBe("failed");
  });
});

describe("extractCitations - edge cases", () => {
  it("handles frames with string value", () => {
    const frames = [makeFrame({ data: { metric: "status", value: "active" } })];
    const citations = extractCitations(frames);
    expect(citations).toHaveLength(1);
    expect(citations[0].value).toBe("active");
  });

  it("handles maxCount=0", () => {
    const frames = [makeFrame()];
    expect(extractCitations(frames, 0)).toHaveLength(0);
  });
});

describe("parseModelSpec - edge cases", () => {
  it("handles provider with dots", () => {
    const result = parseModelSpec("vertex-ai.google/gemini-pro");
    expect(result.provider).toBe("vertex-ai.google");
    expect(result.modelId).toBe("gemini-pro");
  });
});

describe("cleanIntentText - edge cases", () => {
  it("handles text with multiple colons", () => {
    expect(cleanIntentText("operator_intent: \"time: 14:30\""))
      .toBe("time: 14:30");
  });

  it("handles only whitespace (trailing stripped by regex)", () => {
    // The regex strips trailing whitespace/quotes
    expect(cleanIntentText("   ")).toBe("");
  });
});

describe("classifyEvent - comprehensive unknown types", () => {
  it("skips turn_end", () => {
    expect(classifyEvent({ type: "turn_end" })).toEqual({ type: "skip" });
  });

  it("skips auto_retry_end", () => {
    expect(classifyEvent({ type: "auto_retry_end" })).toEqual({ type: "skip" });
  });

  it("handles empty object", () => {
    expect(classifyEvent({})).toEqual({ type: "skip" });
  });
});

describe("summarizeProposals - additional cases", () => {
  it("handles multiple proposals", () => {
    const proposals = [
      makeProposal({ taskId: "12345678-abc", summary: "P1" }),
      makeProposal({ taskId: "87654321-xyz", summary: "P2" }),
    ];
    const result = summarizeProposals(proposals);
    expect(result).toHaveLength(2);
    expect(result[0].taskId).toBe("12345678...");
    expect(result[1].taskId).toBe("87654321...");
  });
});

describe("countPending - additional cases", () => {
  it("counts only proposed (not just awaiting_approval)", () => {
    const map = new Map<string, TaskProposal>([
      ["a", makeProposal({ taskId: "a", status: "proposed" })],
    ]);
    expect(countPending(map)).toBe(1);
  });
});
