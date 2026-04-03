/**
 * Pure helper functions for the ClawMesh mesh extension.
 * Extracted from clawmesh-mesh-extension.ts for testability.
 */

import type { ContextFrame } from "../../mesh/context-types.js";
import type { TaskProposal } from "../types.js";
import { formatProposalOwner } from "../proposal-formatting.js";

/**
 * Format an array of context frames into a human-readable string.
 * Used by query_world_model tool to present data to the LLM.
 */
export function formatFrames(frames: ContextFrame[]): string {
  if (frames.length === 0) return "No context frames found.";

  return frames
    .map((f) => {
      const ts = new Date(f.timestamp).toISOString();
      const src = f.sourceDisplayName ?? f.sourceDeviceId.slice(0, 12) + "...";
      const lines = [`[${f.kind}] ${src} @ ${ts}`];
      lines.push(`Data: ${JSON.stringify(f.data, null, 2)}`);
      if (f.note) lines.push(`Note: ${f.note}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

/**
 * Find a proposal by its ID prefix. Returns the first match.
 */
export function findProposalByPrefix(
  proposals: Map<string, TaskProposal>,
  prefix: string,
): TaskProposal | undefined {
  for (const p of proposals.values()) {
    if (p.taskId.startsWith(prefix)) return p;
  }
  return undefined;
}

/**
 * Find a peer that provides a given capability reference.
 * Tries exact match first, then prefix match (first two segments).
 */
export function findPeerForCapability(
  findPeers: (ref: string) => string[],
  targetRef: string,
): string | null {
  const exactPeers = findPeers(targetRef);
  if (exactPeers.length > 0) return exactPeers[0];
  const prefix = targetRef.split(":").slice(0, 2).join(":");
  const prefixPeers = findPeers(prefix);
  return prefixPeers.length > 0 ? prefixPeers[0] : null;
}

/**
 * Summarize proposals into a compact display format.
 */
export function summarizeProposals(
  proposals: TaskProposal[],
): Array<{
  taskId: string;
  summary: string;
  targetRef: string;
  operation: string;
  approvalLevel: string;
  status: string;
  plannerDeviceId?: string;
  plannerRole?: string;
  plannerOwner?: string;
  createdAt: string;
}> {
  return proposals.map((p) => ({
    taskId: p.taskId.slice(0, 8) + "...",
    summary: p.summary,
    targetRef: p.targetRef,
    operation: p.operation,
    approvalLevel: p.approvalLevel,
    status: p.status,
    plannerDeviceId: p.plannerDeviceId,
    plannerRole: p.plannerRole,
    plannerOwner: formatProposalOwner(p),
    createdAt: new Date(p.createdAt).toISOString(),
  }));
}

/**
 * Count pending proposals (proposed or awaiting_approval).
 */
export function countPending(proposals: Map<string, TaskProposal>): number {
  let count = 0;
  for (const p of proposals.values()) {
    if (p.status === "proposed" || p.status === "awaiting_approval") count++;
  }
  return count;
}

export function buildDuplicateProposalNotice(
  operation: string,
  targetRef: string,
  ownerPlannerDeviceId?: string,
): string {
  const base = `A similar action was already proposed recently (${operation} on ${targetRef}). Wait for the existing proposal to be resolved.`;
  if (!ownerPlannerDeviceId) return base;
  return `${base} Owned by planner ${ownerPlannerDeviceId.slice(0, 12)}….`;
}

/**
 * Format uptime in a compact human-readable format.
 * Extracted from mesh-tui.ts for reuse and testability.
 */
export function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  return `${m}m${String(sec).padStart(2, "0")}s`;
}

/**
 * Format a compact data summary for a gossip frame.
 * Extracted from mesh-tui.ts buildGossipColumn for testability.
 */
export function compactDataSummary(data: Record<string, any>): string {
  if (data.zone && data.metric && data.value !== undefined) {
    return `${data.zone} ${data.metric}=${data.value}${data.unit ?? ""}`;
  }
  if (data.intent) return String(data.intent).slice(0, 30);
  if (data.decision) return String(data.decision).slice(0, 30);
  if (data.reasoning) return String(data.reasoning).slice(0, 30);
  const json = JSON.stringify(data);
  return json.length > 32 ? json.slice(0, 30) + "…" : json;
}
