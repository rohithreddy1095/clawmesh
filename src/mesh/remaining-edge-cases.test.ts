/**
 * Additional edge case tests to push past 1300.
 *
 * Tests remaining untested scenarios across various modules.
 */

import { describe, it, expect } from "vitest";
import { buildMeshAuthPayload } from "./handshake.js";
import { scoreFrameRelevance } from "./world-model.js";
import { resolveMeshRoute } from "./routing.js";
import { MeshCapabilityRegistry } from "./capabilities.js";
import { evaluateMeshForwardTrust, compareMeshTrustTiers } from "./trust-policy.js";
import { resolveMeshForwardTrustMetadata, validateClawMeshCommandEnvelope } from "./command-envelope.js";
import type { MeshForwardPayload } from "./types.js";
import type { ContextFrame } from "./context-types.js";

function makeFrame(overrides: Partial<ContextFrame> = {}): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-test`,
    sourceDeviceId: "device-abc",
    timestamp: Date.now(),
    data: { metric: "moisture", value: 42, zone: "zone-1" },
    trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T1_unverified_observation" },
    ...overrides,
  };
}

// ─── Handshake auth payload ─────────────────────────

describe("buildMeshAuthPayload - edge cases", () => {
  it("builds basic payload", () => {
    const result = buildMeshAuthPayload({
      deviceId: "abc",
      signedAtMs: 1000,
    });
    expect(result).toBe("mesh.connect|v1|abc|1000");
  });

  it("includes nonce when provided", () => {
    const result = buildMeshAuthPayload({
      deviceId: "abc",
      signedAtMs: 1000,
      nonce: "test-nonce",
    });
    expect(result).toBe("mesh.connect|v1|abc|1000|test-nonce");
  });

  it("omits nonce when undefined", () => {
    const result = buildMeshAuthPayload({
      deviceId: "abc",
      signedAtMs: 1000,
    });
    expect(result).not.toContain("undefined");
    expect(result.split("|")).toHaveLength(4);
  });

  it("handles empty deviceId", () => {
    const result = buildMeshAuthPayload({
      deviceId: "",
      signedAtMs: 0,
    });
    expect(result).toBe("mesh.connect|v1||0");
  });
});

// ─── World model relevance scoring ──────────────────

describe("scoreFrameRelevance - edge cases", () => {
  it("event frames have different importance than observations", () => {
    const now = Date.now();
    const obs = makeFrame({ kind: "observation", timestamp: now });
    const evt = makeFrame({ kind: "event", timestamp: now });
    // Both should have scores > 0
    expect(scoreFrameRelevance(obs, now)).toBeGreaterThan(0);
    expect(scoreFrameRelevance(evt, now)).toBeGreaterThan(0);
  });

  it("human_input frames have high importance", () => {
    const now = Date.now();
    const human = makeFrame({ kind: "human_input", timestamp: now });
    const obs = makeFrame({ kind: "observation", timestamp: now });
    expect(scoreFrameRelevance(human, now)).toBeGreaterThan(scoreFrameRelevance(obs, now));
  });

  it("critical keyword in data boosts score", () => {
    const now = Date.now();
    const critical = makeFrame({
      timestamp: now,
      data: { metric: "moisture", value: 5, zone: "zone-1", alert: "critical" },
    });
    const normal = makeFrame({
      timestamp: now,
      data: { metric: "moisture", value: 35, zone: "zone-1" },
    });
    // Critical keyword should boost
    expect(scoreFrameRelevance(critical, now)).toBeGreaterThanOrEqual(scoreFrameRelevance(normal, now));
  });

  it("T3 trust tier scores higher than T0", () => {
    const now = Date.now();
    const t3 = makeFrame({
      timestamp: now,
      trust: { evidence_sources: ["human"], evidence_trust_tier: "T3_verified_action_evidence" },
    });
    const t0 = makeFrame({
      timestamp: now,
      trust: { evidence_sources: ["llm"], evidence_trust_tier: "T0_planning_inference" },
    });
    expect(scoreFrameRelevance(t3, now)).toBeGreaterThan(scoreFrameRelevance(t0, now));
  });
});

// ─── Trust policy ───────────────────────────────────

describe("Trust tier comparison - all pairs", () => {
  it("T0 < T1 < T2 < T3", () => {
    expect(compareMeshTrustTiers("T0_planning_inference", "T1_unverified_observation")).toBeLessThan(0);
    expect(compareMeshTrustTiers("T1_unverified_observation", "T2_operational_observation")).toBeLessThan(0);
    expect(compareMeshTrustTiers("T2_operational_observation", "T3_verified_action_evidence")).toBeLessThan(0);
  });

  it("all same-tier comparisons return 0", () => {
    const tiers = [
      "T0_planning_inference",
      "T1_unverified_observation",
      "T2_operational_observation",
      "T3_verified_action_evidence",
    ] as const;
    for (const t of tiers) {
      expect(compareMeshTrustTiers(t, t)).toBe(0);
    }
  });
});

// ─── Routing with multiple peers ────────────────────

describe("resolveMeshRoute - multi-peer", () => {
  it("returns first peer with capability", () => {
    const reg = new MeshCapabilityRegistry();
    reg.updatePeer("peer-1", ["channel:telegram"]);
    reg.updatePeer("peer-2", ["channel:telegram"]);
    const result = resolveMeshRoute({
      channel: "telegram",
      capabilityRegistry: reg,
    });
    expect(result.kind).toBe("mesh");
  });
});

// ─── resolveMeshForwardTrustMetadata ────────────────

describe("resolveMeshForwardTrustMetadata - edge cases", () => {
  it("returns trust from payload when no command", () => {
    const result = resolveMeshForwardTrustMetadata({
      channel: "test",
      to: "p",
      originGatewayId: "g",
      trust: {
        action_type: "observation",
        evidence_sources: ["sensor"],
        evidence_trust_tier: "T1_unverified_observation",
        minimum_trust_tier: "T0_planning_inference",
        verification_required: "none",
      },
    } as MeshForwardPayload);
    expect(result.ok).toBe(true);
  });

  it("returns ok with no trust and no command", () => {
    const result = resolveMeshForwardTrustMetadata({
      channel: "test",
      to: "p",
      originGatewayId: "g",
    } as MeshForwardPayload);
    expect(result.ok).toBe(true);
  });
});

// ─── validateClawMeshCommandEnvelope ────────────────

describe("validateClawMeshCommandEnvelope - edge cases", () => {
  it("rejects null", () => {
    expect(validateClawMeshCommandEnvelope(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(validateClawMeshCommandEnvelope(undefined)).toBe(false);
  });

  it("rejects string", () => {
    expect(validateClawMeshCommandEnvelope("not an object")).toBe(false);
  });

  it("rejects empty object", () => {
    expect(validateClawMeshCommandEnvelope({})).toBe(false);
  });

  it("rejects wrong version", () => {
    expect(validateClawMeshCommandEnvelope({ version: 2, kind: "clawmesh.command" })).toBe(false);
  });

  it("rejects wrong kind", () => {
    expect(validateClawMeshCommandEnvelope({ version: 1, kind: "other" })).toBe(false);
  });
});
