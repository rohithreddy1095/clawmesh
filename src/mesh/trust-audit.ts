/**
 * Trust Audit Trail — logs every trust evaluation decision.
 *
 * Every time evaluateMeshForwardTrust() is called, the result can be
 * recorded here for compliance, debugging, and operational review.
 *
 * Features:
 *   - In-memory ring buffer for recent decisions
 *   - Queryable by action type, decision, time range
 *   - Statistics: approval rate, rejection reasons
 */

import type { MeshForwardPayload, MeshForwardTrustMetadata } from "./types.js";

// ─── Types ──────────────────────────────────────────────────

export type TrustDecisionRecord = {
  /** When the decision was made. */
  timestamp: number;
  /** The target of the forward. */
  to: string;
  /** Channel. */
  channel: string;
  /** Origin gateway. */
  originGatewayId: string;
  /** Action type from trust metadata. */
  actionType?: string;
  /** Trust tier of the evidence. */
  evidenceTier?: string;
  /** Evidence sources. */
  evidenceSources?: string[];
  /** Whether the decision was OK. */
  ok: boolean;
  /** Rejection code (if not ok). */
  code?: string;
  /** Rejection message (if not ok). */
  message?: string;
};

export type TrustAuditStats = {
  total: number;
  approved: number;
  rejected: number;
  approvalRate: number;
  rejectionsByCode: Record<string, number>;
};

// ─── Audit Trail ────────────────────────────────────────────

export class TrustAuditTrail {
  private readonly records: TrustDecisionRecord[] = [];
  private readonly maxRecords: number;

  constructor(opts?: { maxRecords?: number }) {
    this.maxRecords = opts?.maxRecords ?? 1000;
  }

  /**
   * Record a trust evaluation decision.
   */
  record(
    payload: MeshForwardPayload,
    decision: { ok: boolean; code?: string; message?: string },
  ): TrustDecisionRecord {
    const trust = payload.trust;

    const record: TrustDecisionRecord = {
      timestamp: Date.now(),
      to: payload.to,
      channel: payload.channel,
      originGatewayId: payload.originGatewayId,
      actionType: trust?.action_type,
      evidenceTier: trust?.evidence_trust_tier,
      evidenceSources: trust?.evidence_sources ? [...trust.evidence_sources] : undefined,
      ok: decision.ok,
      code: decision.code,
      message: decision.message,
    };

    this.records.push(record);

    // Trim to max
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }

    return record;
  }

  /**
   * Get recent records.
   */
  getRecent(limit: number = 50): TrustDecisionRecord[] {
    return this.records.slice(-limit);
  }

  /**
   * Get records matching filters.
   */
  query(filters: {
    ok?: boolean;
    actionType?: string;
    channel?: string;
    since?: number;
  }): TrustDecisionRecord[] {
    return this.records.filter((r) => {
      if (filters.ok !== undefined && r.ok !== filters.ok) return false;
      if (filters.actionType && r.actionType !== filters.actionType) return false;
      if (filters.channel && r.channel !== filters.channel) return false;
      if (filters.since && r.timestamp < filters.since) return false;
      return true;
    });
  }

  /**
   * Compute aggregate statistics.
   */
  getStats(): TrustAuditStats {
    const total = this.records.length;
    const approved = this.records.filter((r) => r.ok).length;
    const rejected = total - approved;

    const rejectionsByCode: Record<string, number> = {};
    for (const r of this.records) {
      if (!r.ok && r.code) {
        rejectionsByCode[r.code] = (rejectionsByCode[r.code] ?? 0) + 1;
      }
    }

    return {
      total,
      approved,
      rejected,
      approvalRate: total > 0 ? approved / total : 0,
      rejectionsByCode,
    };
  }

  /** Number of records. */
  get size(): number {
    return this.records.length;
  }

  /** Clear all records. */
  clear(): void {
    this.records.length = 0;
  }
}
