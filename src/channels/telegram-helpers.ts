/**
 * Pure helper functions for the Telegram channel.
 * Extracted from telegram.ts for testability.
 */

import type { ContextFrame } from "../mesh/context-types.js";

/**
 * Escape special characters for Telegram MarkdownV2.
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

/**
 * Chunk a message into parts that fit Telegram's character limit.
 * Tries to break at newlines for readability.
 */
export function chunkMessage(text: string, limit: number = 4000): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    let breakPoint = remaining.lastIndexOf("\n", limit);
    if (breakPoint < limit * 0.5) breakPoint = limit;
    chunks.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint).trimStart();
  }
  return chunks;
}

/**
 * Severity levels for alert filtering.
 */
export const SEVERITY_MAP: Record<string, number> = {
  normal: 0,
  low: 1,
  critical: 2,
};

/**
 * Check if a frame's severity meets the minimum threshold.
 */
export function meetsAlertSeverity(
  frameSeverity: string | undefined,
  minSeverity: string,
): boolean {
  if (!frameSeverity) return false;
  return (SEVERITY_MAP[frameSeverity] ?? 0) >= (SEVERITY_MAP[minSeverity] ?? 1);
}

/**
 * Format an alert message from a context frame.
 * Returns null if the frame is not alert-worthy.
 */
export function formatAlertMessage(frame: ContextFrame): string | null {
  if (frame.kind !== "observation") return null;

  const data = frame.data;
  const status = data.status as string | undefined;
  if (!status) return null;

  const icon = status === "critical" ? "🚨" : status === "low" ? "⚠️" : "📊";
  const zone = data.zone ?? "unknown";
  const metric = data.metric ?? "unknown";
  const value = data.value;
  const unit = data.unit ?? "";
  const source = frame.sourceDisplayName ?? frame.sourceDeviceId.slice(0, 12);

  return `${icon} *Alert:* ${zone} ${metric} = ${value}${unit} (${status})\nSource: ${source}`;
}

/**
 * Format citations into a readable text block.
 */
export function formatCitations(
  citations: Array<{ metric: string; value: unknown; zone?: string; timestamp: number }>,
): string {
  if (citations.length === 0) return "";
  return citations.map(c => {
    const time = new Date(c.timestamp).toLocaleTimeString();
    return `📍 ${c.zone ? `${c.zone} ` : ""}${c.metric}: ${c.value} (${time})`;
  }).join("\n");
}

/**
 * Format a proposal notification message in MarkdownV2.
 */
export function formatProposalNotification(proposal: {
  approvalLevel: string;
  summary: string;
  targetRef: string;
  operation: string;
  taskId: string;
  reasoning?: string;
}): string {
  return (
    `⚠️ *New Proposal* \\[${escapeMarkdownV2(proposal.approvalLevel)}\\]\n\n` +
    `${escapeMarkdownV2(proposal.summary)}\n\n` +
    `*Target:* ${escapeMarkdownV2(proposal.targetRef)}\n` +
    `*Operation:* ${escapeMarkdownV2(proposal.operation)}\n` +
    `*Task ID:* \`${proposal.taskId.slice(0, 8)}\`\n\n` +
    `_${escapeMarkdownV2(proposal.reasoning?.slice(0, 300) ?? "")}_`
  );
}

/**
 * Get the status icon for a resolved proposal.
 */
export function proposalStatusIcon(status: string): string {
  if (status === "approved" || status === "completed") return "✅";
  if (status === "rejected") return "❌";
  if (status === "executing") return "⏳";
  return "·";
}
