/**
 * Tests for LLM response analysis helpers.
 */

import { describe, it, expect } from "vitest";
import {
  hasAssistantContent,
  getLastMessage,
  findRecentProposalIds,
} from "./llm-response-helpers.js";

describe("hasAssistantContent", () => {
  it("returns true for text content", () => {
    expect(hasAssistantContent({
      role: "assistant",
      content: [{ type: "text", text: "Hello" }],
    })).toBe(true);
  });

  it("returns true for tool call content", () => {
    expect(hasAssistantContent({
      role: "assistant",
      content: [{ type: "toolCall", name: "read_sensors" }],
    })).toBe(true);
  });

  it("returns false for empty text", () => {
    expect(hasAssistantContent({
      role: "assistant",
      content: [{ type: "text", text: "   " }],
    })).toBe(false);
  });

  it("returns false for null message", () => {
    expect(hasAssistantContent(null)).toBe(false);
  });

  it("returns false for user message", () => {
    expect(hasAssistantContent({
      role: "user",
      content: [{ type: "text", text: "Hello" }],
    })).toBe(false);
  });

  it("returns false for empty content array", () => {
    expect(hasAssistantContent({
      role: "assistant",
      content: [],
    })).toBe(false);
  });

  it("returns false for missing content", () => {
    expect(hasAssistantContent({ role: "assistant" })).toBe(false);
  });

  it("returns true for mixed text + tool calls", () => {
    expect(hasAssistantContent({
      role: "assistant",
      content: [
        { type: "text", text: "" },
        { type: "toolCall", name: "query" },
      ],
    })).toBe(true);
  });
});

describe("getLastMessage", () => {
  it("returns last element of array", () => {
    const msgs = [{ role: "user" }, { role: "assistant" }];
    expect(getLastMessage(msgs)).toEqual({ role: "assistant" });
  });

  it("returns null for empty array", () => {
    expect(getLastMessage([])).toBeNull();
  });

  it("returns single element", () => {
    expect(getLastMessage([{ role: "user" }])).toEqual({ role: "user" });
  });
});

describe("findRecentProposalIds", () => {
  it("finds proposals within time window", () => {
    const now = Date.now();
    const proposals = [
      { taskId: "task-1", createdAt: now - 5000 },
      { taskId: "task-2", createdAt: now - 15000 },
      { taskId: "task-3", createdAt: now - 2000 },
    ];

    const ids = findRecentProposalIds(proposals, 10_000, now);
    expect(ids).toEqual(["task-1", "task-3"]);
  });

  it("returns empty for no recent proposals", () => {
    const now = Date.now();
    const proposals = [
      { taskId: "task-1", createdAt: now - 60000 },
    ];
    expect(findRecentProposalIds(proposals, 10_000, now)).toEqual([]);
  });

  it("returns empty for empty array", () => {
    expect(findRecentProposalIds([])).toEqual([]);
  });

  it("respects custom window", () => {
    const now = Date.now();
    const proposals = [{ taskId: "task-1", createdAt: now - 3000 }];
    expect(findRecentProposalIds(proposals, 2000, now)).toEqual([]);
    expect(findRecentProposalIds(proposals, 5000, now)).toEqual(["task-1"]);
  });
});
