import { describe, it, expect } from "vitest";
import { buildLlmOnlyActuationTrust } from "../mesh/node-runtime.js";
import { defaultActuationTrust } from "../mesh/actuation-sender.js";
import { resolveMeshRoute } from "../mesh/routing.js";
import { MeshCapabilityRegistry } from "../mesh/capabilities.js";
import {
  createClawMeshCommandEnvelope,
  validateClawMeshCommandEnvelope,
  resolveMeshForwardTrustMetadata,
  buildClawMeshForwardPayload,
} from "../mesh/command-envelope.js";
import { compareMeshTrustTiers } from "../mesh/trust-policy.js";
import { scoreFrameRelevance } from "../mesh/world-model.js";
import { calculateSyncSince } from "../mesh/context-sync.js";
import type { ContextFrame } from "../mesh/context-types.js";

function makeFrame(overrides: Partial<ContextFrame> = {}): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "device-abc",
    timestamp: Date.now(),
    data: { metric: "moisture", value: 42, zone: "zone-1" },
    trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T1_unverified_observation" },
    ...overrides,
  };
}

// ─── Trust utilities ────────────────────────────────

describe("buildLlmOnlyActuationTrust", () => {
  it("returns actuation trust metadata", () => {
    const trust = buildLlmOnlyActuationTrust()!;
    expect(trust.action_type).toBe("actuation");
    expect(trust.evidence_sources).toContain("llm");
    expect(trust.evidence_trust_tier).toBe("T3_verified_action_evidence");
    expect(trust.minimum_trust_tier).toBe("T2_operational_observation");
  });

  it("does not require human verification", () => {
    const trust = buildLlmOnlyActuationTrust()!;
    expect(trust.verification_required).toBe("none");
  });
});

describe("defaultActuationTrust", () => {
  it("returns valid trust metadata", () => {
    const trust = defaultActuationTrust();
    expect(trust.action_type).toBe("actuation");
    expect(trust.evidence_trust_tier).toBe("T3_verified_action_evidence");
    expect(trust.verification_required).toBe("human");
    expect(trust.verification_satisfied).toBe(true);
  });

  it("includes operator approval", () => {
    const trust = defaultActuationTrust();
    expect(trust.approved_by).toContain("operator:local-cli");
  });

  it("returns new object each call", () => {
    const a = defaultActuationTrust();
    const b = defaultActuationTrust();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ─── Routing ────────────────────────────────────────

describe("resolveMeshRoute - expanded", () => {
  it("returns local when capability is in local set", () => {
    const reg = new MeshCapabilityRegistry();
    const result = resolveMeshRoute({
      channel: "telegram",
      capabilityRegistry: reg,
      localCapabilities: new Set(["channel:telegram"]),
    });
    expect(result).toEqual({ kind: "local" });
  });

  it("returns mesh when peer has capability", () => {
    const reg = new MeshCapabilityRegistry();
    reg.updatePeer("peer-1", ["channel:whatsapp"]);
    const result = resolveMeshRoute({
      channel: "whatsapp",
      capabilityRegistry: reg,
    });
    expect(result).toEqual({ kind: "mesh", peerDeviceId: "peer-1" });
  });

  it("returns unavailable when no match", () => {
    const reg = new MeshCapabilityRegistry();
    const result = resolveMeshRoute({
      channel: "slack",
      capabilityRegistry: reg,
    });
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("prefers local over mesh", () => {
    const reg = new MeshCapabilityRegistry();
    reg.updatePeer("peer-1", ["channel:telegram"]);
    const result = resolveMeshRoute({
      channel: "telegram",
      capabilityRegistry: reg,
      localCapabilities: new Set(["channel:telegram"]),
    });
    expect(result.kind).toBe("local");
  });

  it("handles empty capabilities", () => {
    const reg = new MeshCapabilityRegistry();
    const result = resolveMeshRoute({
      channel: "test",
      capabilityRegistry: reg,
      localCapabilities: new Set(),
    });
    expect(result.kind).toBe("unavailable");
  });
});

// ─── Trust tier comparison ──────────────────────────

describe("compareMeshTrustTiers - expanded", () => {
  it("T0 < T1", () => {
    expect(compareMeshTrustTiers("T0_planning_inference", "T1_unverified_observation")).toBeLessThan(0);
  });

  it("T2 > T1", () => {
    expect(compareMeshTrustTiers("T2_operational_observation", "T1_unverified_observation")).toBeGreaterThan(0);
  });

  it("same tier equals 0", () => {
    expect(compareMeshTrustTiers("T3_verified_action_evidence", "T3_verified_action_evidence")).toBe(0);
  });

  it("T3 > T0", () => {
    expect(compareMeshTrustTiers("T3_verified_action_evidence", "T0_planning_inference")).toBeGreaterThan(0);
  });
});

// ─── Frame relevance scoring ────────────────────────

describe("scoreFrameRelevance - expanded", () => {
  it("recent frames score higher", () => {
    const now = Date.now();
    const recent = makeFrame({ timestamp: now - 1_000 });
    const old = makeFrame({ timestamp: now - 600_000 });
    expect(scoreFrameRelevance(recent, now)).toBeGreaterThan(scoreFrameRelevance(old, now));
  });

  it("observation frames have baseline relevance", () => {
    const frame = makeFrame({ kind: "observation", timestamp: Date.now() });
    expect(scoreFrameRelevance(frame)).toBeGreaterThan(0);
  });

  it("very old frames have low recency but may have kind/trust score", () => {
    const now = Date.now();
    const ancient = makeFrame({ timestamp: now - 86_400_000 }); // 24h ago
    // Recency near 0 but kind importance + trust tier still contribute
    const score = scoreFrameRelevance(ancient, now);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(10); // Most of the score is non-recency
  });
});

// ─── Context sync timing ────────────────────────────

describe("calculateSyncSince - expanded", () => {
  it("returns lookback window for null timestamp", () => {
    // null means "no known frames" → returns now - maxLookback
    const since = calculateSyncSince(null);
    expect(since).toBeGreaterThan(0);
    expect(since).toBeLessThan(Date.now());
  });

  it("returns timestamp minus buffer for known frame", () => {
    const ts = 1000000;
    const since = calculateSyncSince(ts);
    // Should be ts - 60000 (1 minute buffer)
    expect(since).toBe(ts - 60_000);
  });

  it("custom lookback window", () => {
    const since = calculateSyncSince(null, 60_000); // 1 minute lookback
    const expected = Date.now() - 60_000;
    expect(Math.abs(since - expected)).toBeLessThan(100); // within 100ms
  });
});

// ─── Command envelope building ──────────────────────

describe("buildClawMeshForwardPayload", () => {
  it("builds a valid forward payload", () => {
    const result = buildClawMeshForwardPayload({
      to: "recipient",
      originGatewayId: "gateway-1",
      idempotencyKey: "key-123",
      command: {
        target: { kind: "capability", ref: "actuator:pump:P1" },
        operation: { name: "start" },
        trust: {
          action_type: "actuation",
          evidence_sources: ["sensor", "human"],
          evidence_trust_tier: "T3_verified_action_evidence",
          minimum_trust_tier: "T2_operational_observation",
          verification_required: "human",
          verification_satisfied: true,
          approved_by: ["operator"],
        },
      },
    });
    expect(result.channel).toBe("clawmesh");
    expect(result.to).toBe("recipient");
    expect(result.originGatewayId).toBe("gateway-1");
    expect(result.command).toBeDefined();
    expect(result.command?.target.ref).toBe("actuator:pump:P1");
    expect(result.trust).toBeDefined();
  });

  it("includes optional message", () => {
    const result = buildClawMeshForwardPayload({
      to: "r",
      originGatewayId: "g",
      idempotencyKey: "k",
      command: {
        target: { kind: "capability", ref: "sensor:moisture:zone-1" },
        operation: { name: "read" },
        trust: {
          action_type: "observation",
          evidence_sources: ["sensor"],
          evidence_trust_tier: "T1_unverified_observation",
          minimum_trust_tier: "T0_planning_inference",
          verification_required: "none",
        },
      },
      message: "Hello",
    });
    expect(result.message).toBe("Hello");
  });
});

describe("createClawMeshCommandEnvelope - edge cases", () => {
  it("creates envelope with required fields", () => {
    const env = createClawMeshCommandEnvelope({
      target: { kind: "capability", ref: "sensor:moisture:zone-1" },
      operation: { name: "read" },
      trust: {
        action_type: "observation",
        evidence_sources: ["sensor"],
        evidence_trust_tier: "T1_unverified_observation",
        minimum_trust_tier: "T0_planning_inference",
        verification_required: "none",
      },
    });
    expect(env.version).toBe(1);
    expect(env.kind).toBe("clawmesh.command");
    expect(env.commandId).toBeTruthy();
    expect(env.createdAtMs).toBeGreaterThan(0);
    expect(env.target.ref).toBe("sensor:moisture:zone-1");
    expect(env.operation.name).toBe("read");
  });

  it("includes optional operation params", () => {
    const env = createClawMeshCommandEnvelope({
      target: { kind: "capability", ref: "actuator:pump:P1" },
      operation: { name: "set", params: { value: 42 } },
      trust: {
        action_type: "observation",
        evidence_sources: ["sensor"],
        evidence_trust_tier: "T1_unverified_observation",
        minimum_trust_tier: "T0_planning_inference",
        verification_required: "none",
      },
    });
    expect(env.operation.params).toEqual({ value: 42 });
  });
});
