/**
 * Tests for PiSession broadcast helpers.
 *
 * Validates frame construction, pattern gossip payloads,
 * and error/rate-limit response building.
 */

import { describe, it, expect } from "vitest";
import {
  buildAgentResponseFrame,
  buildPatternGossipFrame,
  buildErrorResponse,
  buildRateLimitResponse,
} from "./broadcast-helpers.js";

describe("buildAgentResponseFrame", () => {
  it("creates frame with all response fields", () => {
    const frame = buildAgentResponseFrame(
      {
        conversationId: "conv-1",
        requestId: "req-1",
        message: "Zone-1 moisture is 12%",
        status: "complete",
        proposals: ["task-abc"],
        citations: [{ metric: "soil_moisture", value: 12, zone: "zone-1", timestamp: Date.now() }],
      },
      "device-01",
      "Farm Hub",
    );

    expect(frame.kind).toBe("agent_response");
    expect(frame.frameId).toMatch(/^ar-/);
    expect(frame.sourceDeviceId).toBe("device-01");
    expect(frame.sourceDisplayName).toBe("Farm Hub");
    expect(frame.data.message).toBe("Zone-1 moisture is 12%");
    expect(frame.data.status).toBe("complete");
    expect(frame.data.proposals).toEqual(["task-abc"]);
    expect(frame.data.citations).toHaveLength(1);
    expect(frame.trust.evidence_sources).toContain("llm");
  });

  it("creates thinking status frame", () => {
    const frame = buildAgentResponseFrame(
      { message: "", status: "thinking" },
      "dev-1",
      "hub",
    );
    expect(frame.data.status).toBe("thinking");
    expect(frame.data.message).toBe("");
  });

  it("creates error status frame", () => {
    const frame = buildAgentResponseFrame(
      { message: "Something went wrong", status: "error" },
      "dev-1",
      "hub",
    );
    expect(frame.data.status).toBe("error");
  });

  it("generates unique frame IDs", () => {
    const f1 = buildAgentResponseFrame({ message: "", status: "complete" }, "d1", "h1");
    const f2 = buildAgentResponseFrame({ message: "", status: "complete" }, "d1", "h1");
    expect(f1.frameId).not.toBe(f2.frameId);
  });
});

describe("buildPatternGossipFrame", () => {
  it("wraps patterns in capability_update frame", () => {
    const patterns = [
      {
        triggerCondition: "moisture below 20%",
        action: { operation: "irrigate", targetRef: "pump-01" },
        confidence: 0.85,
        approvalCount: 5,
        rejectionCount: 1,
      },
    ];

    const frame = buildPatternGossipFrame(patterns);
    expect(frame.kind).toBe("capability_update");
    expect(frame.data.type).toBe("learned_patterns");
    expect(frame.data.patterns).toHaveLength(1);
    expect(frame.data.patterns[0].confidence).toBe(0.85);
    expect(frame.note).toContain("1 learned patterns");
    expect(frame.trust.evidence_sources).toContain("human");
  });

  it("handles empty patterns array", () => {
    const frame = buildPatternGossipFrame([]);
    expect(frame.data.patterns).toHaveLength(0);
    expect(frame.note).toContain("0 learned patterns");
  });

  it("handles multiple patterns", () => {
    const patterns = Array.from({ length: 5 }, (_, i) => ({
      triggerCondition: `condition-${i}`,
      action: { operation: "op", targetRef: `ref-${i}` },
      confidence: 0.5 + i * 0.1,
      approvalCount: i,
      rejectionCount: 0,
    }));

    const frame = buildPatternGossipFrame(patterns);
    expect(frame.data.patterns).toHaveLength(5);
    expect(frame.note).toContain("5 learned patterns");
  });
});

describe("buildErrorResponse", () => {
  it("builds error response with conversation context", () => {
    const resp = buildErrorResponse("conv-1", "req-1", "Rate limit exceeded");
    expect(resp).not.toBeNull();
    expect(resp!.conversationId).toBe("conv-1");
    expect(resp!.requestId).toBe("req-1");
    expect(resp!.message).toBe("Rate limit exceeded");
    expect(resp!.status).toBe("error");
  });

  it("returns null without conversationId", () => {
    expect(buildErrorResponse(undefined, "req-1", "error")).toBeNull();
  });

  it("handles missing requestId", () => {
    const resp = buildErrorResponse("conv-1", undefined, "error");
    expect(resp).not.toBeNull();
    expect(resp!.requestId).toBeUndefined();
  });
});

describe("buildRateLimitResponse", () => {
  it("builds standard rate limit message", () => {
    const resp = buildRateLimitResponse("conv-1", "req-1");
    expect(resp).not.toBeNull();
    expect(resp!.message).toContain("rate-limited");
    expect(resp!.status).toBe("error");
  });

  it("returns null without conversationId", () => {
    expect(buildRateLimitResponse(undefined, undefined)).toBeNull();
  });
});
