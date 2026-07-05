import { describe, expect, it, beforeEach } from "vitest";
import { createWorldQueryHandlers } from "./world-query.js";
import { WorldModel } from "../world-model.js";
import type { ContextFrame } from "../context-types.js";

const noop = { info: () => {} };

type Handlers = Record<string, (opts: {
  params: Record<string, unknown>;
  respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void;
}) => void | Promise<void>>;

function makeFrame(overrides?: Partial<ContextFrame>): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "sensor-a",
    timestamp: Date.now(),
    data: { zone: "zone-1", metric: "moisture", value: 31 },
    trust: {
      evidence_sources: ["sensor"],
      evidence_trust_tier: "T2_operational_observation",
    },
    ...overrides,
  };
}

function callHandler(
  handlers: Handlers,
  params: Record<string, unknown> = {},
) {
  return new Promise<{ ok: boolean; payload?: unknown; error?: { code: string; message: string } }>((resolve) => {
    const respond = (ok: boolean, payload?: unknown, error?: { code: string; message: string }) =>
      resolve({ ok, payload, error });
    void handlers["mesh.world.query"]({ params, respond });
  });
}

describe("mesh.world.query handler", () => {
  let worldModel: WorldModel;
  let handlers: Handlers;

  beforeEach(() => {
    worldModel = new WorldModel({ log: noop });
    handlers = createWorldQueryHandlers({ worldModel });
  });

  it("returns recent frames with provenance fields and breakdowns", async () => {
    worldModel.ingest(makeFrame({
      frameId: "obs-a",
      sourceDeviceId: "sensor-a",
      kind: "observation",
      trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    }));
    worldModel.ingest(makeFrame({
      frameId: "event-b",
      sourceDeviceId: "node-b",
      kind: "event",
      data: { event: "pump-started" },
      trust: { evidence_sources: ["device"], evidence_trust_tier: "T3_verified_action_evidence" },
    }));

    const { ok, payload } = await callHandler(handlers, { limit: 10 });

    expect(ok).toBe(true);
    const result = payload as {
      count: number;
      entries: number;
      frames: ContextFrame[];
      bySourceDeviceId: Record<string, number>;
      byKind: Record<string, number>;
      byTrustTier: Record<string, number>;
      peerTimestamp: number;
    };
    expect(result.count).toBe(2);
    expect(result.entries).toBe(2);
    expect(result.frames.map((f) => f.frameId)).toEqual(["obs-a", "event-b"]);
    expect(result.frames[0].sourceDeviceId).toBe("sensor-a");
    expect(result.frames[0].trust.evidence_trust_tier).toBe("T2_operational_observation");
    expect(result.bySourceDeviceId).toEqual({ "sensor-a": 1, "node-b": 1 });
    expect(result.byKind).toEqual({ observation: 1, event: 1 });
    expect(result.byTrustTier).toEqual({
      T2_operational_observation: 1,
      T3_verified_action_evidence: 1,
    });
    expect(result.peerTimestamp).toBeGreaterThan(0);
  });

  it("caps limit at 200 and filters by kind and sourceDeviceId", async () => {
    for (let i = 0; i < 205; i++) {
      worldModel.ingest(makeFrame({
        frameId: `obs-${i}`,
        sourceDeviceId: i % 2 === 0 ? "sensor-a" : "sensor-b",
        timestamp: i,
      }));
    }
    worldModel.ingest(makeFrame({
      frameId: "event-latest",
      sourceDeviceId: "sensor-a",
      kind: "event",
      timestamp: 999,
      data: { event: "latest" },
      trust: { evidence_sources: ["device"], evidence_trust_tier: "T3_verified_action_evidence" },
    }));

    const capped = await callHandler(handlers, { limit: 999 });
    expect((capped.payload as { count: number }).count).toBe(200);

    const filtered = await callHandler(handlers, {
      limit: 999,
      kind: "event",
      sourceDeviceId: "sensor-a",
    });
    const result = filtered.payload as { count: number; frames: ContextFrame[]; byKind: Record<string, number> };
    expect(result.count).toBe(1);
    expect(result.frames[0].frameId).toBe("event-latest");
    expect(result.byKind).toEqual({ event: 1 });
  });
});
