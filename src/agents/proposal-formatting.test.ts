import { describe, expect, it } from "vitest";
import { buildProposalDecisionNotice, formatProposalOwner, formatProposalSummaryLine } from "./proposal-formatting.js";

describe("formatProposalOwner", () => {
  it("formats planner owner with role and device prefix", () => {
    expect(formatProposalOwner({
      plannerDeviceId: "planner-abcdef1234567890",
      plannerRole: "planner",
    })).toBe("planner:planner-abcd…");
  });

  it("defaults role when only device id is known", () => {
    expect(formatProposalOwner({
      plannerDeviceId: "planner-abcdef1234567890",
    })).toBe("planner:planner-abcd…");
  });

  it("returns undefined when no planner device is known", () => {
    expect(formatProposalOwner({})).toBeUndefined();
  });
});

describe("formatProposalSummaryLine", () => {
  const proposal = {
    taskId: "abcd1234-5678-90ab-cdef",
    summary: "Irrigate zone-1",
    approvalLevel: "L2" as const,
    status: "awaiting_approval" as const,
    plannerDeviceId: "planner-abcdef1234567890",
    plannerRole: "standby-planner" as const,
  };

  it("includes status and owner by default", () => {
    expect(formatProposalSummaryLine(proposal)).toBe(
      "[abcd1234] AWAITING_APPROVAL L2 — Irrigate zone-1 (owner: standby-planner:planner-abcd…)"
    );
  });

  it("can omit status for compact pending summaries", () => {
    expect(formatProposalSummaryLine(proposal, { includeStatus: false })).toBe(
      "[abcd1234] L2 Irrigate zone-1 (owner: standby-planner:planner-abcd…)"
    );
  });

  it("omits owner segment when planner is unknown", () => {
    expect(formatProposalSummaryLine({
      ...proposal,
      plannerDeviceId: undefined,
      plannerRole: undefined,
    })).toBe("[abcd1234] AWAITING_APPROVAL L2 — Irrigate zone-1");
  });

  it("shows leader handoff hint when current leader differs from proposal owner", () => {
    expect(formatProposalSummaryLine(proposal, {
      leader: { deviceId: "planner-newleader999", role: "planner" },
    })).toBe(
      "[abcd1234] AWAITING_APPROVAL L2 — Irrigate zone-1 (owner: standby-planner:planner-abcd…; leader: planner:planner-newl…)"
    );
  });

  it("does not repeat leader when owner already matches elected leader", () => {
    expect(formatProposalSummaryLine({
      ...proposal,
      plannerRole: "planner",
    }, {
      leader: { deviceId: "planner-abcdef1234567890", role: "planner" },
    })).toBe(
      "[abcd1234] AWAITING_APPROVAL L2 — Irrigate zone-1 (owner: planner:planner-abcd…)"
    );
  });
});

describe("buildProposalDecisionNotice", () => {
  const proposal = {
    taskId: "abcd1234-5678-90ab-cdef",
    summary: "Irrigate zone-1",
    approvalLevel: "L2" as const,
    status: "awaiting_approval" as const,
    plannerDeviceId: "planner-abcdef1234567890",
    plannerRole: "planner" as const,
  };

  it("includes owner when known", () => {
    expect(buildProposalDecisionNotice("Approved", proposal)).toBe(
      "Approved: Irrigate zone-1 (owner: planner:planner-abcd…)"
    );
  });

  it("falls back to plain summary when owner unknown", () => {
    expect(buildProposalDecisionNotice("Rejected", {
      ...proposal,
      plannerDeviceId: undefined,
      plannerRole: undefined,
    })).toBe("Rejected: Irrigate zone-1");
  });
});
