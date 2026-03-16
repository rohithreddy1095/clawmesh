import { describe, it, expect } from "vitest";
import {
  classifyEvent,
  extractAssistantText,
  extractToolCallNames,
} from "./session-event-classifier.js";

// ─── classifyEvent ──────────────────────────────────

describe("classifyEvent", () => {
  it("skips message_update events", () => {
    expect(classifyEvent({ type: "message_update" })).toEqual({ type: "skip" });
  });

  it("extracts model from message_start", () => {
    const result = classifyEvent({
      type: "message_start",
      message: { role: "assistant", model: "claude-sonnet-4-5-20250929" },
    });
    expect(result).toEqual({ type: "message_start", model: "claude-sonnet-4-5-20250929" });
  });

  it("skips message_start without assistant role", () => {
    expect(classifyEvent({
      type: "message_start",
      message: { role: "user", model: "x" },
    })).toEqual({ type: "skip" });
  });

  it("skips message_start without model", () => {
    expect(classifyEvent({
      type: "message_start",
      message: { role: "assistant" },
    })).toEqual({ type: "skip" });
  });

  it("skips message_start without message", () => {
    expect(classifyEvent({ type: "message_start" })).toEqual({ type: "skip" });
  });

  it("extracts error from message_end", () => {
    const result = classifyEvent({
      type: "message_end",
      message: { errorMessage: "rate limited" },
    });
    expect(result).toEqual({ type: "message_error", error: "rate limited" });
  });

  it("extracts assistant text from message_end", () => {
    const result = classifyEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello world" }],
      },
    });
    expect(result).toEqual({ type: "assistant_text", text: "Hello world" });
  });

  it("joins multiple text blocks", () => {
    const result = classifyEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Block 1" },
          { type: "text", text: "Block 2" },
        ],
      },
    });
    expect(result).toEqual({ type: "assistant_text", text: "Block 1\nBlock 2" });
  });

  it("extracts tool calls from message_end", () => {
    const result = classifyEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", name: "query_world_model" },
          { type: "toolCall", name: "propose_task" },
        ],
      },
    });
    expect(result).toEqual({
      type: "tool_calls",
      names: ["query_world_model", "propose_task"],
    });
  });

  it("skips message_end without message", () => {
    expect(classifyEvent({ type: "message_end" })).toEqual({ type: "skip" });
  });

  it("skips message_end with empty content", () => {
    expect(classifyEvent({
      type: "message_end",
      message: { role: "assistant", content: [] },
    })).toEqual({ type: "skip" });
  });

  it("skips whitespace-only text blocks", () => {
    expect(classifyEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "   \n  " }],
      },
    })).toEqual({ type: "skip" });
  });

  it("classifies tool_execution_start", () => {
    const result = classifyEvent({
      type: "tool_execution_start",
      toolName: "query_world_model",
      args: { kind: "observation", limit: 10 },
    });
    expect(result).toEqual({
      type: "tool_start",
      name: "query_world_model",
      args: expect.stringContaining("observation"),
    });
  });

  it("truncates long args in tool_execution_start", () => {
    const result = classifyEvent({
      type: "tool_execution_start",
      toolName: "test",
      args: { data: "a".repeat(200) },
    });
    expect(result.type).toBe("tool_start");
    if (result.type === "tool_start") {
      expect(result.args.length).toBeLessThanOrEqual(120);
    }
  });

  it("classifies tool_execution_end error", () => {
    const result = classifyEvent({
      type: "tool_execution_end",
      toolName: "query_world_model",
      isError: true,
    });
    expect(result).toEqual({ type: "tool_error", name: "query_world_model" });
  });

  it("skips successful tool_execution_end", () => {
    expect(classifyEvent({
      type: "tool_execution_end",
      toolName: "test",
      isError: false,
    })).toEqual({ type: "skip" });
  });

  it("classifies auto_retry_start", () => {
    expect(classifyEvent({ type: "auto_retry_start" })).toEqual({ type: "auto_retry" });
  });

  it("classifies auto_compaction_start", () => {
    expect(classifyEvent({ type: "auto_compaction_start" })).toEqual({ type: "compaction_start" });
  });

  it("classifies auto_compaction_end", () => {
    expect(classifyEvent({ type: "auto_compaction_end" })).toEqual({ type: "compaction_end" });
  });

  it("skips unknown event types", () => {
    expect(classifyEvent({ type: "agent_start" })).toEqual({ type: "skip" });
    expect(classifyEvent({ type: "agent_end" })).toEqual({ type: "skip" });
    expect(classifyEvent({ type: "turn_start" })).toEqual({ type: "skip" });
  });

  it("handles missing toolName gracefully", () => {
    const result = classifyEvent({ type: "tool_execution_start" });
    expect(result).toEqual({ type: "tool_start", name: "unknown", args: "{}" });
  });

  it("prefers error over text in message_end", () => {
    // Error takes priority
    const result = classifyEvent({
      type: "message_end",
      message: {
        role: "assistant",
        errorMessage: "oops",
        content: [{ type: "text", text: "some text" }],
      },
    });
    expect(result.type).toBe("message_error");
  });
});

// ─── extractAssistantText ───────────────────────────

describe("extractAssistantText", () => {
  it("extracts text from assistant message", () => {
    const text = extractAssistantText({
      role: "assistant",
      content: [
        { type: "text", text: "Hello" },
        { type: "text", text: "World" },
      ],
    });
    expect(text).toBe("Hello\n\nWorld");
  });

  it("returns null for user messages", () => {
    expect(extractAssistantText({ role: "user", content: [] })).toBeNull();
  });

  it("returns null for empty content", () => {
    expect(extractAssistantText({ role: "assistant", content: [] })).toBeNull();
  });

  it("returns null for whitespace-only blocks", () => {
    expect(extractAssistantText({
      role: "assistant",
      content: [{ type: "text", text: "   " }],
    })).toBeNull();
  });

  it("skips non-text blocks", () => {
    const text = extractAssistantText({
      role: "assistant",
      content: [
        { type: "toolCall", name: "test" },
        { type: "text", text: "Result" },
      ],
    });
    expect(text).toBe("Result");
  });

  it("handles missing content", () => {
    expect(extractAssistantText({ role: "assistant" })).toBeNull();
  });
});

// ─── extractToolCallNames ───────────────────────────

describe("extractToolCallNames", () => {
  it("extracts tool call names", () => {
    const names = extractToolCallNames({
      content: [
        { type: "toolCall", name: "query_world_model" },
        { type: "toolCall", name: "propose_task" },
      ],
    });
    expect(names).toEqual(["query_world_model", "propose_task"]);
  });

  it("returns empty for no tool calls", () => {
    expect(extractToolCallNames({
      content: [{ type: "text", text: "hello" }],
    })).toEqual([]);
  });

  it("returns empty for missing content", () => {
    expect(extractToolCallNames({})).toEqual([]);
  });

  it("returns empty for empty content", () => {
    expect(extractToolCallNames({ content: [] })).toEqual([]);
  });
});
