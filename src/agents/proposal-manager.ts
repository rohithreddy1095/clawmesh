/**
 * ProposalManager — manages task proposal lifecycle.
 *
 * Extracted from PiSession for testability. Handles:
 * - Proposal storage and lookup
 * - Approve/reject with validation
 * - Filtering by status
 * - Pattern memory recording on decisions
 */

import type { TaskProposal } from "./types.js";

export interface DecisionRecord {
  approved: boolean;
  triggerCondition: string;
  action: {
    operation: string;
    targetRef: string;
    operationParams?: Record<string, unknown>;
    summary: string;
  };
  triggerEventId?: string;
}

export class ProposalManager {
  private proposals = new Map<string, TaskProposal>();
  private onDecision?: (record: DecisionRecord) => void;
  private onResolved?: (proposal: TaskProposal) => void;

  constructor(opts?: {
    onDecision?: (record: DecisionRecord) => void;
    onResolved?: (proposal: TaskProposal) => void;
  }) {
    this.onDecision = opts?.onDecision;
    this.onResolved = opts?.onResolved;
  }

  add(proposal: TaskProposal): void {
    this.proposals.set(proposal.taskId, proposal);
  }

  get(taskId: string): TaskProposal | undefined {
    return this.proposals.get(taskId);
  }

  list(filter?: { status?: TaskProposal["status"] }): TaskProposal[] {
    const all = [...this.proposals.values()];
    return filter?.status ? all.filter((p) => p.status === filter.status) : all;
  }

  /**
   * Count proposals in pending states (proposed or awaiting_approval).
   */
  countPending(): number {
    let count = 0;
    for (const p of this.proposals.values()) {
      if (p.status === "proposed" || p.status === "awaiting_approval") count++;
    }
    return count;
  }

  /**
   * Approve a proposal. Returns the proposal if successful, null otherwise.
   * Records the decision and calls onResolved callback.
   */
  approve(taskId: string, approvedBy = "operator"): TaskProposal | null {
    const proposal = this.proposals.get(taskId);
    if (!proposal || proposal.status !== "awaiting_approval") return null;

    proposal.status = "approved";
    proposal.resolvedBy = approvedBy;

    this.onDecision?.({
      approved: true,
      triggerCondition: proposal.reasoning || proposal.summary,
      action: {
        operation: proposal.operation,
        targetRef: proposal.targetRef,
        operationParams: proposal.operationParams,
        summary: proposal.summary,
      },
      triggerEventId: proposal.triggerFrameIds?.[0],
    });

    return proposal;
  }

  /**
   * Reject a proposal. Returns the proposal if successful, null otherwise.
   */
  reject(taskId: string, rejectedBy = "operator"): TaskProposal | null {
    const proposal = this.proposals.get(taskId);
    if (!proposal || proposal.status !== "awaiting_approval") return null;

    proposal.status = "rejected";
    proposal.resolvedAt = Date.now();
    proposal.resolvedBy = rejectedBy;

    this.onDecision?.({
      approved: false,
      triggerCondition: proposal.reasoning || proposal.summary,
      action: {
        operation: proposal.operation,
        targetRef: proposal.targetRef,
        operationParams: proposal.operationParams,
        summary: proposal.summary,
      },
      triggerEventId: proposal.triggerFrameIds?.[0],
    });

    this.onResolved?.(proposal);
    return proposal;
  }

  /**
   * Find a proposal by prefix of its taskId.
   */
  findByPrefix(prefix: string): TaskProposal | undefined {
    for (const p of this.proposals.values()) {
      if (p.taskId.startsWith(prefix)) return p;
    }
    return undefined;
  }

  /**
   * Mark a proposal as completed after execution.
   */
  complete(taskId: string, result: { ok: boolean; error?: string; payload?: unknown }): TaskProposal | null {
    const proposal = this.proposals.get(taskId);
    if (!proposal) return null;

    proposal.status = result.ok ? "completed" : "failed";
    proposal.result = result;
    proposal.resolvedAt = Date.now();

    this.onResolved?.(proposal);
    return proposal;
  }

  /**
   * Get all proposals as a Map (for extension state compatibility).
   */
  getMap(): Map<string, TaskProposal> {
    return this.proposals;
  }

  /**
   * Clear all proposals.
   */
  clear(): void {
    this.proposals.clear();
  }

  get size(): number {
    return this.proposals.size;
  }
}
