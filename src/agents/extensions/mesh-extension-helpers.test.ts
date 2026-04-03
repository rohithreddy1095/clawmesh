import { describe, it, expect } from "vitest";
import {
  formatFrames,
  findProposalByPrefix,
  findPeerForCapability,
  summarizeProposals,
  countPending,
  fmtUptime,
  compactDataSummary,
} from "./mesh-extension-helpers.js";
import type { ContextFrame } from "../../mesh/context-types.js";
import type { TaskProposal } from "../types.js";

// ─── Test helpers ───────────────────────────────────────

function makeFrame(overrides: Partial<ContextFrame> = {}): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "device-abc123456789",
    timestamp: Date.now(),
    data: { metric: "moisture", value: 42, zone: "zone-1" },
    trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T1_unverified_observation" },
    ...overrides,
  };
}

function makeProposal(overrides: Partial<TaskProposal> = {}): TaskProposal {
  return {
    taskId: "abcd1234-5678-90ab-cdef-1234567890ab",
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

// ─── formatFrames ───────────────────────────────────────

describe("formatFrames", () => {
  it("returns placeholder for empty array", () => {
    expect(formatFrames([])).toBe("No context frames found.");
  });

  it("formats a single frame with kind, source, timestamp", () => {
    const frame = makeFrame({
      sourceDisplayName: "Sensor Node A",
      timestamp: new Date("2026-03-15T10:00:00Z").getTime(),
    });
    const result = formatFrames([frame]);
    expect(result).toContain("[observation]");
    expect(result).toContain("Sensor Node A");
    expect(result).toContain("2026-03-15");
    expect(result).toContain('"moisture"');
  });

  it("uses deviceId prefix when no displayName", () => {
    const frame = makeFrame({ sourceDeviceId: "abcdef123456789xyz" });
    delete (frame as any).sourceDisplayName;
    const result = formatFrames([frame]);
    expect(result).toContain("abcdef123456...");
  });

  it("includes note when present", () => {
    const frame = makeFrame({ note: "Irrigation check" });
    const result = formatFrames([frame]);
    expect(result).toContain("Note: Irrigation check");
  });

  it("omits note line when absent", () => {
    const frame = makeFrame();
    delete (frame as any).note;
    const result = formatFrames([frame]);
    expect(result).not.toContain("Note:");
  });

  it("separates multiple frames with double newline", () => {
    const frames = [makeFrame(), makeFrame()];
    const result = formatFrames(frames);
    expect(result.split("\n\n").length).toBeGreaterThanOrEqual(2);
  });

  it("handles various frame kinds", () => {
    for (const kind of ["event", "human_input", "inference"] as const) {
      const frame = makeFrame({ kind, sourceDisplayName: "test" });
      const result = formatFrames([frame]);
      expect(result).toContain(`[${kind}]`);
    }
  });
});

// ─── findProposalByPrefix ───────────────────────────────

describe("findProposalByPrefix", () => {
  it("finds proposal by full ID", () => {
    const p = makeProposal();
    const map = new Map([[p.taskId, p]]);
    expect(findProposalByPrefix(map, p.taskId)).toBe(p);
  });

  it("finds proposal by prefix", () => {
    const p = makeProposal({ taskId: "abcd1234-rest-of-id" });
    const map = new Map([[p.taskId, p]]);
    expect(findProposalByPrefix(map, "abcd1234")).toBe(p);
  });

  it("returns undefined when no match", () => {
    const p = makeProposal();
    const map = new Map([[p.taskId, p]]);
    expect(findProposalByPrefix(map, "zzzzz")).toBeUndefined();
  });

  it("returns first match when multiple match", () => {
    const p1 = makeProposal({ taskId: "abc-111" });
    const p2 = makeProposal({ taskId: "abc-222" });
    const map = new Map([[p1.taskId, p1], [p2.taskId, p2]]);
    const result = findProposalByPrefix(map, "abc");
    expect(result).toBeDefined();
    expect(result!.taskId.startsWith("abc")).toBe(true);
  });

  it("returns undefined for empty map", () => {
    expect(findProposalByPrefix(new Map(), "abc")).toBeUndefined();
  });
});

// ─── findPeerForCapability ──────────────────────────────

describe("findPeerForCapability", () => {
  it("returns exact match peer", () => {
    const findPeers = (ref: string) =>
      ref === "sensor:moisture:zone-1" ? ["peer-a"] : [];
    expect(findPeerForCapability(findPeers, "sensor:moisture:zone-1")).toBe("peer-a");
  });

  it("falls back to prefix match", () => {
    const findPeers = (ref: string) =>
      ref === "sensor:moisture" ? ["peer-b"] : [];
    expect(findPeerForCapability(findPeers, "sensor:moisture:zone-2")).toBe("peer-b");
  });

  it("returns null when no match at all", () => {
    const findPeers = () => [] as string[];
    expect(findPeerForCapability(findPeers, "sensor:moisture:zone-1")).toBeNull();
  });

  it("prefers exact match over prefix", () => {
    const findPeers = (ref: string) => {
      if (ref === "actuator:pump:P1") return ["exact-peer"];
      if (ref === "actuator:pump") return ["prefix-peer"];
      return [];
    };
    expect(findPeerForCapability(findPeers, "actuator:pump:P1")).toBe("exact-peer");
  });

  it("handles single-segment ref gracefully", () => {
    const findPeers = (ref: string) =>
      ref === "sensor" ? ["peer-c"] : [];
    // single segment — prefix becomes "sensor" (only one segment)
    expect(findPeerForCapability(findPeers, "sensor")).toBe("peer-c");
  });
});

// ─── summarizeProposals ─────────────────────────────────

describe("summarizeProposals", () => {
  it("returns empty array for no proposals", () => {
    expect(summarizeProposals([])).toEqual([]);
  });

  it("truncates taskId to 8 chars + ellipsis", () => {
    const p = makeProposal({ taskId: "12345678-9abc-defg-hijk" });
    const [s] = summarizeProposals([p]);
    expect(s.taskId).toBe("12345678...");
  });

  it("includes all key fields", () => {
    const p = makeProposal({
      summary: "Open valve",
      targetRef: "actuator:valve:V1",
      operation: "open",
      approvalLevel: "L3",
      status: "completed",
      plannerDeviceId: "planner-abcdef1234567890",
      plannerRole: "standby-planner",
    });
    const [s] = summarizeProposals([p]);
    expect(s.summary).toBe("Open valve");
    expect(s.targetRef).toBe("actuator:valve:V1");
    expect(s.operation).toBe("open");
    expect(s.approvalLevel).toBe("L3");
    expect(s.status).toBe("completed");
    expect(s.plannerDeviceId).toBe("planner-abcdef1234567890");
    expect(s.plannerRole).toBe("standby-planner");
    expect(s.plannerOwner).toBe("standby-planner:planner-abcd…");
  });

  it("formats createdAt as ISO string", () => {
    const ts = new Date("2026-01-15T08:30:00Z").getTime();
    const p = makeProposal({ createdAt: ts });
    const [s] = summarizeProposals([p]);
    expect(s.createdAt).toContain("2026-01-15");
  });
});

// ─── countPending ───────────────────────────────────────

describe("countPending", () => {
  it("returns 0 for empty map", () => {
    expect(countPending(new Map())).toBe(0);
  });

  it("counts proposed and awaiting_approval", () => {
    const map = new Map<string, TaskProposal>([
      ["a", makeProposal({ taskId: "a", status: "proposed" })],
      ["b", makeProposal({ taskId: "b", status: "awaiting_approval" })],
      ["c", makeProposal({ taskId: "c", status: "completed" })],
      ["d", makeProposal({ taskId: "d", status: "rejected" })],
    ]);
    expect(countPending(map)).toBe(2);
  });

  it("returns 0 when all resolved", () => {
    const map = new Map<string, TaskProposal>([
      ["a", makeProposal({ taskId: "a", status: "completed" })],
      ["b", makeProposal({ taskId: "b", status: "failed" })],
    ]);
    expect(countPending(map)).toBe(0);
  });
});

// ─── fmtUptime ──────────────────────────────────────────

describe("fmtUptime", () => {
  it("formats seconds", () => {
    expect(fmtUptime(5000)).toBe("0m05s");
  });

  it("formats minutes and seconds", () => {
    expect(fmtUptime(125_000)).toBe("2m05s");
  });

  it("formats hours and minutes", () => {
    expect(fmtUptime(3_661_000)).toBe("1h01m");
  });

  it("formats zero", () => {
    expect(fmtUptime(0)).toBe("0m00s");
  });

  it("formats large hours", () => {
    expect(fmtUptime(86_400_000)).toBe("24h00m"); // 24 hours
  });

  it("pads single-digit seconds", () => {
    expect(fmtUptime(3_000)).toBe("0m03s");
  });

  it("pads single-digit minutes in hour format", () => {
    expect(fmtUptime(3_900_000)).toBe("1h05m"); // 1h5m
  });
});

// ─── compactDataSummary ─────────────────────────────────

describe("compactDataSummary", () => {
  it("formats zone+metric+value", () => {
    expect(compactDataSummary({ zone: "zone-1", metric: "moisture", value: 42 }))
      .toBe("zone-1 moisture=42");
  });

  it("includes unit when present", () => {
    expect(compactDataSummary({ zone: "zone-1", metric: "temp", value: 28.5, unit: "°C" }))
      .toBe("zone-1 temp=28.5°C");
  });

  it("prefers intent field", () => {
    expect(compactDataSummary({ intent: "check irrigation status" }))
      .toBe("check irrigation status");
  });

  it("prefers decision field", () => {
    expect(compactDataSummary({ decision: "activate pump P1" }))
      .toBe("activate pump P1");
  });

  it("prefers reasoning field", () => {
    expect(compactDataSummary({ reasoning: "moisture too low" }))
      .toBe("moisture too low");
  });

  it("falls back to JSON for unknown data", () => {
    expect(compactDataSummary({ foo: "bar" }))
      .toBe('{"foo":"bar"}');
  });

  it("truncates long JSON", () => {
    const longData = { description: "a".repeat(100) };
    const result = compactDataSummary(longData);
    expect(result.length).toBeLessThanOrEqual(32);
    expect(result).toContain("…");
  });

  it("truncates long intent", () => {
    const result = compactDataSummary({ intent: "a".repeat(50) });
    expect(result.length).toBe(30);
  });
});
