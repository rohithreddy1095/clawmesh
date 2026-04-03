import type { TaskProposal } from "./types.js";

export function formatProposalOwner(params: {
  plannerDeviceId?: string;
  plannerRole?: "planner" | "standby-planner";
}): string | undefined {
  if (!params.plannerDeviceId) return undefined;
  return `${params.plannerRole ?? "planner"}:${params.plannerDeviceId.slice(0, 12)}…`;
}

export function formatProposalSummaryLine(
  proposal: Pick<
    TaskProposal,
    "taskId" | "summary" | "approvalLevel" | "status" | "plannerDeviceId" | "plannerRole"
  >,
  opts?: {
    includeStatus?: boolean;
    leader?: { deviceId: string; role?: "planner" | "standby-planner" };
  },
): string {
  const owner = formatProposalOwner(proposal);
  const leader = opts?.leader ? formatProposalOwner({
    plannerDeviceId: opts.leader.deviceId,
    plannerRole: opts.leader.role,
  }) : undefined;
  const prefix = `[${proposal.taskId.slice(0, 8)}]`;
  const base = opts?.includeStatus === false
    ? `${prefix} ${proposal.approvalLevel} ${proposal.summary}`
    : `${prefix} ${proposal.status.toUpperCase()} ${proposal.approvalLevel} — ${proposal.summary}`;
  if (!owner) return base;
  if (leader && leader !== owner) return `${base} (owner: ${owner}; leader: ${leader})`;
  return `${base} (owner: ${owner})`;
}

export function formatPendingProposalStatusLines(
  proposals: Array<Pick<
    TaskProposal,
    "taskId" | "summary" | "approvalLevel" | "status" | "plannerDeviceId" | "plannerRole"
  >>,
  opts?: {
    limit?: number;
    leader?: { deviceId: string; role?: "planner" | "standby-planner" };
  },
): string[] {
  return proposals
    .filter((p) => p.status === "proposed" || p.status === "awaiting_approval")
    .slice(0, opts?.limit ?? 3)
    .map((p) => `  ${formatProposalSummaryLine(p, { includeStatus: false, leader: opts?.leader })}`);
}

export function buildProposalDecisionNotice(
  action: string,
  proposal: Pick<TaskProposal, "summary" | "plannerDeviceId" | "plannerRole">,
): string {
  const owner = formatProposalOwner(proposal);
  return owner ? `${action}: ${proposal.summary} (owner: ${owner})` : `${action}: ${proposal.summary}`;
}
