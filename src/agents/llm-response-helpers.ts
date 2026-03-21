/**
 * LLM response analysis helpers — extracted from PiSession for testability.
 *
 * Analyzes LLM responses to determine if content was produced,
 * extract text, and check for tool calls.
 */

/**
 * Check if an LLM message has meaningful content (text or tool calls).
 * Used to detect empty responses from rate limiting.
 */
export function hasAssistantContent(message: Record<string, any> | null): boolean {
  if (!message || message.role !== "assistant") return false;
  const content = message.content;
  if (!Array.isArray(content)) return false;
  return content.some(
    (c: any) => (c.type === "text" && c.text?.trim()) || c.type === "toolCall",
  );
}

/**
 * Get the last message from a messages array.
 */
export function getLastMessage(messages: any[]): Record<string, any> | null {
  return messages.length > 0 ? messages[messages.length - 1] : null;
}

/**
 * Find recently created proposals (within a time window).
 */
export function findRecentProposalIds(
  proposals: Array<{ taskId: string; createdAt: number }>,
  windowMs = 10_000,
  now = Date.now(),
): string[] {
  return proposals
    .filter(p => p.createdAt >= now - windowMs)
    .map(p => p.taskId);
}
