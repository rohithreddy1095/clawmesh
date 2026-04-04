import { describe, expect, it } from "vitest";
import { mergeChatMessages } from "../ui/src/lib/chat-message-state.js";
import type { ChatMessage } from "../ui/src/lib/store.js";

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: overrides.id ?? "msg-1",
    conversationId: overrides.conversationId ?? "conv-1",
    role: overrides.role ?? "agent",
    text: overrides.text ?? "",
    timestamp: overrides.timestamp ?? 1,
    status: overrides.status,
    citations: overrides.citations,
    proposals: overrides.proposals,
  };
}

describe("mergeChatMessages", () => {
  it("adds queued status when no transient message exists", () => {
    const result = mergeChatMessages([], message({ id: "queued-1", status: "queued" }));
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("queued");
  });

  it("replaces queued with thinking for the same conversation", () => {
    const queued = message({ id: "queued-1", status: "queued" });
    const thinking = message({ id: "thinking-1", status: "thinking" });

    const result = mergeChatMessages([queued], thinking);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("thinking-1");
    expect(result[0].status).toBe("thinking");
  });

  it("replaces thinking with complete for the same conversation", () => {
    const thinking = message({ id: "thinking-1", status: "thinking" });
    const complete = message({ id: "complete-1", status: "complete", text: "done" });

    const result = mergeChatMessages([thinking], complete);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("complete-1");
    expect(result[0].status).toBe("complete");
    expect(result[0].text).toBe("done");
  });

  it("does not let queued overwrite an active thinking indicator", () => {
    const thinking = message({ id: "thinking-1", status: "thinking" });
    const queued = message({ id: "queued-1", status: "queued" });

    const result = mergeChatMessages([thinking], queued);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("thinking-1");
    expect(result[0].status).toBe("thinking");
  });
});
