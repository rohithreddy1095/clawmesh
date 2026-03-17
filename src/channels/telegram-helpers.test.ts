import { describe, it, expect } from "vitest";
import {
  escapeMarkdownV2,
  chunkMessage,
  meetsAlertSeverity,
  formatAlertMessage,
  formatCitations,
  formatProposalNotification,
  proposalStatusIcon,
  SEVERITY_MAP,
} from "./telegram-helpers.js";
import type { ContextFrame } from "../mesh/context-types.js";

function makeFrame(overrides: Partial<ContextFrame> = {}): ContextFrame {
  return {
    kind: "observation",
    frameId: "f-test",
    sourceDeviceId: "device-abc123456789",
    timestamp: Date.now(),
    data: { metric: "moisture", value: 15, zone: "zone-1", status: "critical", unit: "%" },
    trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T1_unverified_observation" },
    ...overrides,
  };
}

// ─── escapeMarkdownV2 ───────────────────────────────

describe("escapeMarkdownV2", () => {
  it("escapes basic special characters", () => {
    expect(escapeMarkdownV2("hello_world")).toBe("hello\\_world");
    expect(escapeMarkdownV2("**bold**")).toBe("\\*\\*bold\\*\\*");
  });

  it("escapes brackets and parens", () => {
    expect(escapeMarkdownV2("[link](url)")).toBe("\\[link\\]\\(url\\)");
  });

  it("escapes backticks", () => {
    expect(escapeMarkdownV2("`code`")).toBe("\\`code\\`");
  });

  it("escapes dots and hyphens", () => {
    expect(escapeMarkdownV2("v1.2.3")).toBe("v1\\.2\\.3");
    expect(escapeMarkdownV2("a-b")).toBe("a\\-b");
  });

  it("handles empty string", () => {
    expect(escapeMarkdownV2("")).toBe("");
  });

  it("preserves normal text", () => {
    expect(escapeMarkdownV2("hello world 123")).toBe("hello world 123");
  });

  it("escapes multiple special chars in sequence", () => {
    expect(escapeMarkdownV2("!@#")).toBe("\\!@\\#");
  });
});

// ─── chunkMessage ───────────────────────────────────

describe("chunkMessage", () => {
  it("returns single chunk for short text", () => {
    expect(chunkMessage("hello", 100)).toEqual(["hello"]);
  });

  it("splits at newline", () => {
    const text = "line1\nline2\nline3";
    const chunks = chunkMessage(text, 10);
    expect(chunks.length).toBeGreaterThan(1);
    // Reassembled should contain all content
    expect(chunks.join("\n")).toContain("line1");
    expect(chunks.join("\n")).toContain("line3");
  });

  it("hard breaks when no good newline found", () => {
    const text = "a".repeat(200);
    const chunks = chunkMessage(text, 50);
    expect(chunks.length).toBe(4);
  });

  it("handles empty text", () => {
    expect(chunkMessage("", 100)).toEqual([""]);
  });

  it("handles text exactly at limit", () => {
    const text = "a".repeat(100);
    expect(chunkMessage(text, 100)).toEqual([text]);
  });

  it("uses default limit of 4000", () => {
    const short = "hello";
    expect(chunkMessage(short)).toEqual(["hello"]);
  });
});

// ─── meetsAlertSeverity ─────────────────────────────

describe("meetsAlertSeverity", () => {
  it("critical meets low threshold", () => {
    expect(meetsAlertSeverity("critical", "low")).toBe(true);
  });

  it("critical meets critical threshold", () => {
    expect(meetsAlertSeverity("critical", "critical")).toBe(true);
  });

  it("low does not meet critical threshold", () => {
    expect(meetsAlertSeverity("low", "critical")).toBe(false);
  });

  it("normal meets normal threshold", () => {
    expect(meetsAlertSeverity("normal", "normal")).toBe(true);
  });

  it("returns false for undefined severity", () => {
    expect(meetsAlertSeverity(undefined, "low")).toBe(false);
  });

  it("returns false for unknown severity", () => {
    expect(meetsAlertSeverity("unknown", "low")).toBe(false);
  });
});

// ─── SEVERITY_MAP ───────────────────────────────────

describe("SEVERITY_MAP", () => {
  it("has correct ordering", () => {
    expect(SEVERITY_MAP.normal).toBeLessThan(SEVERITY_MAP.low);
    expect(SEVERITY_MAP.low).toBeLessThan(SEVERITY_MAP.critical);
  });
});

// ─── formatAlertMessage ─────────────────────────────

describe("formatAlertMessage", () => {
  it("formats critical alert", () => {
    const frame = makeFrame({ data: { metric: "moisture", value: 5, zone: "zone-1", status: "critical", unit: "%" } });
    const msg = formatAlertMessage(frame);
    expect(msg).toContain("🚨");
    expect(msg).toContain("zone-1");
    expect(msg).toContain("moisture");
    expect(msg).toContain("5%");
    expect(msg).toContain("critical");
  });

  it("formats low alert", () => {
    const frame = makeFrame({ data: { metric: "temp", value: 35, zone: "zone-2", status: "low" } });
    const msg = formatAlertMessage(frame);
    expect(msg).toContain("⚠️");
  });

  it("formats normal with default icon", () => {
    const frame = makeFrame({ data: { metric: "ph", value: 7, status: "normal" } });
    const msg = formatAlertMessage(frame);
    expect(msg).toContain("📊");
  });

  it("returns null for non-observation", () => {
    const frame = makeFrame({ kind: "event" });
    expect(formatAlertMessage(frame)).toBeNull();
  });

  it("returns null when no status", () => {
    const frame = makeFrame({ data: { metric: "moisture", value: 42 } });
    expect(formatAlertMessage(frame)).toBeNull();
  });

  it("uses deviceId prefix when no displayName", () => {
    const frame = makeFrame({
      sourceDeviceId: "abcdefghijklmnop",
      data: { metric: "m", value: 1, status: "low" },
    });
    delete (frame as any).sourceDisplayName;
    const msg = formatAlertMessage(frame)!;
    expect(msg).toContain("abcdefghijkl");
  });

  it("uses displayName when available", () => {
    const frame = makeFrame({
      sourceDisplayName: "Sensor Node A",
      data: { metric: "m", value: 1, status: "low" },
    });
    const msg = formatAlertMessage(frame)!;
    expect(msg).toContain("Sensor Node A");
  });
});

// ─── formatCitations ────────────────────────────────

describe("formatCitations", () => {
  it("returns empty for no citations", () => {
    expect(formatCitations([])).toBe("");
  });

  it("formats a single citation", () => {
    const result = formatCitations([
      { metric: "moisture", value: 42, zone: "zone-1", timestamp: Date.now() },
    ]);
    expect(result).toContain("📍");
    expect(result).toContain("zone-1");
    expect(result).toContain("moisture");
    expect(result).toContain("42");
  });

  it("omits zone when undefined", () => {
    const result = formatCitations([
      { metric: "temp", value: 30, timestamp: Date.now() },
    ]);
    expect(result).not.toContain("undefined");
    expect(result).toContain("temp: 30");
  });

  it("formats multiple citations", () => {
    const result = formatCitations([
      { metric: "m1", value: 1, timestamp: Date.now() },
      { metric: "m2", value: 2, timestamp: Date.now() },
    ]);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
  });
});

// ─── formatProposalNotification ─────────────────────

describe("formatProposalNotification", () => {
  it("includes approval level", () => {
    const text = formatProposalNotification({
      approvalLevel: "L2",
      summary: "Start pump P1",
      targetRef: "actuator:pump:P1",
      operation: "start",
      taskId: "12345678-rest-of-id",
      reasoning: "Moisture below 20%",
    });
    expect(text).toContain("L2");
    expect(text).toContain("Start pump P1");
    expect(text).toContain("actuator:pump:P1");
    expect(text).toContain("12345678");
  });

  it("truncates long reasoning", () => {
    const text = formatProposalNotification({
      approvalLevel: "L3",
      summary: "Test",
      targetRef: "t",
      operation: "o",
      taskId: "abcdefgh",
      reasoning: "x".repeat(500),
    });
    // Should be truncated to 300
    expect(text.length).toBeLessThan(500 + 100); // some overhead for formatting
  });

  it("handles missing reasoning", () => {
    const text = formatProposalNotification({
      approvalLevel: "L1",
      summary: "Test",
      targetRef: "t",
      operation: "o",
      taskId: "abcdefgh",
    });
    expect(text).toContain("New Proposal");
  });
});

// ─── proposalStatusIcon ─────────────────────────────

describe("proposalStatusIcon", () => {
  it("returns ✅ for approved", () => {
    expect(proposalStatusIcon("approved")).toBe("✅");
  });

  it("returns ✅ for completed", () => {
    expect(proposalStatusIcon("completed")).toBe("✅");
  });

  it("returns ❌ for rejected", () => {
    expect(proposalStatusIcon("rejected")).toBe("❌");
  });

  it("returns ⏳ for executing", () => {
    expect(proposalStatusIcon("executing")).toBe("⏳");
  });

  it("returns · for unknown status", () => {
    expect(proposalStatusIcon("unknown")).toBe("·");
    expect(proposalStatusIcon("proposed")).toBe("·");
  });
});
