/**
 * ProposalContext — enriches proposals with decision-relevant context.
 *
 * When an operator sees a proposal in the TUI or Telegram, they need
 * enough context to decide approve/reject without querying the world model.
 *
 * This module builds a self-contained decision context for each proposal.
 */

import type { TaskProposal } from "./types.js";
import type { ContextFrame } from "../mesh/context-types.js";

export interface ProposalDecisionContext {
  proposal: {
    taskId: string;
    summary: string;
    reasoning: string;
    approvalLevel: string;
    age: string;
    targetRef: string;
    operation: string;
  };
  currentConditions: Array<{
    metric: string;
    zone?: string;
    value: unknown;
    unit?: string;
    ageMs: number;
    freshness: string;
  }>;
  patternHistory?: {
    previousApprovals: number;
    previousRejections: number;
    confidence: number;
  };
  warnings: string[];
}

/**
 * Build decision context for a proposal.
 */
export function buildProposalContext(
  proposal: TaskProposal,
  recentFrames: ContextFrame[],
  patterns?: Array<{
    triggerCondition: string;
    action: { operation: string; targetRef: string };
    approvalCount: number;
    rejectionCount: number;
    confidence: number;
  }>,
  now = Date.now(),
): ProposalDecisionContext {
  const ageMs = now - proposal.createdAt;
  const age = formatAge(ageMs);

  // Find relevant sensor readings for this proposal's target
  const targetZone = extractZone(proposal.targetRef);
  const relevantFrames = recentFrames
    .filter(f => f.kind === "observation")
    .filter(f => !targetZone || f.data.zone === targetZone)
    .slice(-5);

  const currentConditions = relevantFrames.map(f => ({
    metric: String(f.data.metric ?? "?"),
    zone: f.data.zone as string | undefined,
    value: f.data.value,
    unit: f.data.unit as string | undefined,
    ageMs: now - f.timestamp,
    freshness: classifyAge(now - f.timestamp),
  }));

  // Check pattern history
  const matchingPattern = patterns?.find(p =>
    p.action.operation === proposal.operation &&
    p.action.targetRef === proposal.targetRef,
  );
  const patternHistory = matchingPattern
    ? {
      previousApprovals: matchingPattern.approvalCount,
      previousRejections: matchingPattern.rejectionCount,
      confidence: matchingPattern.confidence,
    }
    : undefined;

  // Build warnings
  const warnings: string[] = [];
  if (ageMs > 15 * 60_000) {
    warnings.push(`Proposal is ${age} old — conditions may have changed`);
  }
  if (currentConditions.some(c => c.freshness === "stale")) {
    warnings.push("Some sensor readings are stale — verify before approving");
  }
  if (currentConditions.length === 0) {
    warnings.push("No current sensor data available for the target zone");
  }

  return {
    proposal: {
      taskId: proposal.taskId,
      summary: proposal.summary,
      reasoning: proposal.reasoning || "",
      approvalLevel: proposal.approvalLevel,
      age,
      targetRef: proposal.targetRef,
      operation: proposal.operation,
    },
    currentConditions,
    patternHistory,
    warnings,
  };
}

function extractZone(targetRef: string): string | undefined {
  // "actuator:pump:zone-1:P1" → "zone-1" if it matches zone-N pattern
  const parts = targetRef.split(":");
  return parts.find(p => p.startsWith("zone-"));
}

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

function classifyAge(ms: number): string {
  if (ms < 60_000) return "fresh";
  if (ms < 300_000) return "recent";
  if (ms < 900_000) return "aging";
  return "stale";
}
