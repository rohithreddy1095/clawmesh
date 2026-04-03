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
  opts?: { includeStatus?: boolean },
): string {
  const owner = formatProposalOwner(proposal);
  const prefix = `[${proposal.taskId.slice(0, 8)}]`;
  const base = opts?.includeStatus === false
    ? `${prefix} ${proposal.approvalLevel} ${proposal.summary}`
    : `${prefix} ${proposal.status.toUpperCase()} ${proposal.approvalLevel} — ${proposal.summary}`;
  return owner ? `${base} (owner: ${owner})` : base;
}
