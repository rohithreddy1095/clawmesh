/**
 * SessionEventClassifier — classifies and extracts data from Pi agent session events.
 *
 * Extracted from PiSession.handleSessionEvent() for testability.
 * Pure functions — no side effects, no dependencies on PiSession.
 */

export type EventClassification =
  | { type: "skip" }
  | { type: "message_start"; model: string }
  | { type: "message_error"; error: string }
  | { type: "assistant_text"; text: string }
  | { type: "tool_calls"; names: string[] }
  | { type: "tool_start"; name: string; args: string }
  | { type: "tool_error"; name: string }
  | { type: "auto_retry" }
  | { type: "compaction_start" }
  | { type: "compaction_end" };

/**
 * Classify a session event into a structured result.
 * Returns { type: "skip" } for events that don't need handling.
 */
export function classifyEvent(event: Record<string, any>): EventClassification {
  switch (event.type) {
    case "message_update":
      return { type: "skip" };

    case "message_start": {
      const m = event.message;
      if (m?.role === "assistant" && m.model) {
        return { type: "message_start", model: m.model };
      }
      return { type: "skip" };
    }

    case "message_end": {
      const msg = event.message;
      if (!msg) return { type: "skip" };

      if (msg.errorMessage) {
        return { type: "message_error", error: msg.errorMessage };
      }

      if (msg.role === "assistant") {
        const textContent = msg.content?.filter?.((c: any) => c.type === "text") ?? [];
        const texts: string[] = [];
        for (const block of textContent) {
          if (block.text?.trim()) {
            texts.push(block.text);
          }
        }
        if (texts.length > 0) {
          return { type: "assistant_text", text: texts.join("\n") };
        }

        const toolCalls = msg.content?.filter?.((c: any) => c.type === "toolCall") ?? [];
        if (toolCalls.length > 0) {
          return { type: "tool_calls", names: toolCalls.map((t: any) => t.name) };
        }
      }
      return { type: "skip" };
    }

    case "tool_execution_start":
      return {
        type: "tool_start",
        name: event.toolName ?? "unknown",
        args: JSON.stringify(event.args ?? {}).slice(0, 120),
      };

    case "tool_execution_end":
      if (event.isError) {
        return { type: "tool_error", name: event.toolName ?? "unknown" };
      }
      return { type: "skip" };

    case "auto_retry_start":
      return { type: "auto_retry" };

    case "auto_compaction_start":
      return { type: "compaction_start" };

    case "auto_compaction_end":
      return { type: "compaction_end" };

    default:
      return { type: "skip" };
  }
}

/**
 * Extract assistant text blocks from a message_end event message.
 * Returns the joined text or null if no text content.
 */
export function extractAssistantText(message: Record<string, any>): string | null {
  if (message.role !== "assistant") return null;
  const blocks = message.content?.filter?.((c: any) => c.type === "text") ?? [];
  const texts = blocks.map((c: any) => c.text?.trim()).filter(Boolean);
  return texts.length > 0 ? texts.join("\n\n") : null;
}

/**
 * Extract tool call names from a message_end event message.
 */
export function extractToolCallNames(message: Record<string, any>): string[] {
  const toolCalls = message.content?.filter?.((c: any) => c.type === "toolCall") ?? [];
  return toolCalls.map((t: any) => t.name);
}
