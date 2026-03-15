import { describe, it, expect, beforeEach } from "vitest";
import { TrustAuditTrail, type TrustDecisionRecord } from "./trust-audit.js";
import type { MeshForwardPayload } from "./types.js";

function makePayload(overrides?: Partial<MeshForwardPayload>): MeshForwardPayload {
  return {
    channel: "clawmesh",
    to: "actuator:pump:P1",
    originGatewayId: "gateway-1",
    idempotencyKey: "key-1",
    trust: {
      action_type: "actuation",
      evidence_trust_tier: "T3_verified_action_evidence",
      minimum_trust_tier: "T2_operational_observation",
      verification_required: "human",
      verification_satisfied: true,
      evidence_sources: ["sensor", "human"],
    },
    ...overrides,
  };
}

describe("TrustAuditTrail", () => {
  let audit: TrustAuditTrail;

  beforeEach(() => {
    audit = new TrustAuditTrail();
  });

  it("records approved decisions", () => {
    const record = audit.record(makePayload(), { ok: true });

    expect(record.ok).toBe(true);
    expect(record.to).toBe("actuator:pump:P1");
    expect(record.actionType).toBe("actuation");
    expect(record.evidenceTier).toBe("T3_verified_action_evidence");
    expect(record.timestamp).toBeGreaterThan(0);
    expect(audit.size).toBe(1);
  });

  it("records rejected decisions with code and message", () => {
    const record = audit.record(makePayload(), {
      ok: false,
      code: "LLM_ONLY_ACTUATION_BLOCKED",
      message: "actuation cannot be executed from LLM-only evidence",
    });

    expect(record.ok).toBe(false);
    expect(record.code).toBe("LLM_ONLY_ACTUATION_BLOCKED");
    expect(record.message).toContain("LLM-only");
  });

  it("getRecent returns most recent records", () => {
    for (let i = 0; i < 10; i++) {
      audit.record(makePayload({ to: `target-${i}` }), { ok: true });
    }

    const recent = audit.getRecent(3);
    expect(recent).toHaveLength(3);
    expect(recent[0].to).toBe("target-7");
    expect(recent[2].to).toBe("target-9");
  });

  it("query filters by ok status", () => {
    audit.record(makePayload(), { ok: true });
    audit.record(makePayload(), { ok: false, code: "ERR" });
    audit.record(makePayload(), { ok: true });

    const rejected = audit.query({ ok: false });
    expect(rejected).toHaveLength(1);
    expect(rejected[0].ok).toBe(false);
  });

  it("query filters by actionType", () => {
    audit.record(makePayload({ trust: { action_type: "actuation" } }), { ok: true });
    audit.record(makePayload({ trust: { action_type: "observation" } }), { ok: true });

    const actuations = audit.query({ actionType: "actuation" });
    expect(actuations).toHaveLength(1);
  });

  it("query filters by channel", () => {
    audit.record(makePayload({ channel: "clawmesh" }), { ok: true });
    audit.record(makePayload({ channel: "telegram" }), { ok: true });

    const clawmesh = audit.query({ channel: "clawmesh" });
    expect(clawmesh).toHaveLength(1);
  });

  it("query filters by since timestamp", () => {
    const before = Date.now();
    audit.record(makePayload(), { ok: true });

    const after = Date.now() + 100;
    const results = audit.query({ since: after });
    expect(results).toHaveLength(0);

    const allResults = audit.query({ since: before - 100 });
    expect(allResults).toHaveLength(1);
  });

  it("getStats computes correct statistics", () => {
    audit.record(makePayload(), { ok: true });
    audit.record(makePayload(), { ok: true });
    audit.record(makePayload(), { ok: false, code: "LLM_ONLY_ACTUATION_BLOCKED" });
    audit.record(makePayload(), { ok: false, code: "INSUFFICIENT_TRUST_TIER" });
    audit.record(makePayload(), { ok: false, code: "LLM_ONLY_ACTUATION_BLOCKED" });

    const stats = audit.getStats();
    expect(stats.total).toBe(5);
    expect(stats.approved).toBe(2);
    expect(stats.rejected).toBe(3);
    expect(stats.approvalRate).toBeCloseTo(0.4);
    expect(stats.rejectionsByCode["LLM_ONLY_ACTUATION_BLOCKED"]).toBe(2);
    expect(stats.rejectionsByCode["INSUFFICIENT_TRUST_TIER"]).toBe(1);
  });

  it("trims records to maxRecords", () => {
    const small = new TrustAuditTrail({ maxRecords: 5 });

    for (let i = 0; i < 10; i++) {
      small.record(makePayload({ to: `t-${i}` }), { ok: true });
    }

    expect(small.size).toBe(5);
    const recent = small.getRecent(10);
    expect(recent[0].to).toBe("t-5"); // First 5 trimmed
  });

  it("clear removes all records", () => {
    audit.record(makePayload(), { ok: true });
    audit.record(makePayload(), { ok: true });
    audit.clear();
    expect(audit.size).toBe(0);
  });

  it("handles payload without trust metadata", () => {
    const payload: MeshForwardPayload = {
      channel: "clawmesh",
      to: "sensor:temp",
      originGatewayId: "gw",
      idempotencyKey: "k",
    };

    const record = audit.record(payload, { ok: true });
    expect(record.actionType).toBeUndefined();
    expect(record.evidenceTier).toBeUndefined();
    expect(record.evidenceSources).toBeUndefined();
  });
});
