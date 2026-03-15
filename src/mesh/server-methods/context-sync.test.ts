import { describe, it, expect, beforeEach } from "vitest";
import { createContextSyncHandlers } from "./context-sync.js";
import { WorldModel } from "../world-model.js";
import type { ContextFrame } from "../context-types.js";

const noop = { info: () => {} };

function makeFrame(overrides?: Partial<ContextFrame>): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2, 8)}`,
    sourceDeviceId: "device-abc",
    timestamp: Date.now(),
    data: { metric: "moisture", value: 25, zone: "zone-1" },
    trust: {
      evidence_sources: ["sensor"],
      evidence_trust_tier: "T2_operational_observation",
    },
    ...overrides,
  };
}

describe("createContextSyncHandlers", () => {
  let worldModel: WorldModel;
  let handlers: ReturnType<typeof createContextSyncHandlers>;

  beforeEach(() => {
    worldModel = new WorldModel({ log: noop });
    handlers = createContextSyncHandlers({ worldModel });
  });

  it("creates a context.sync handler", () => {
    expect(handlers["context.sync"]).toBeDefined();
    expect(typeof handlers["context.sync"]).toBe("function");
  });

  it("returns frames newer than since timestamp", async () => {
    worldModel.ingest(makeFrame({ frameId: "old", timestamp: 1000 }));
    worldModel.ingest(makeFrame({ frameId: "new", timestamp: 5000, data: { metric: "temp", value: 30, zone: "z2" } }));

    let responsePayload: any;
    await handlers["context.sync"]({
      params: { since: 2000 },
      respond: (ok, payload) => {
        expect(ok).toBe(true);
        responsePayload = payload;
      },
    });

    expect(responsePayload.frames).toHaveLength(1);
    expect(responsePayload.frames[0].frameId).toBe("new");
    expect(responsePayload.peerTimestamp).toBeGreaterThan(0);
  });

  it("returns empty when no frames match", async () => {
    let responsePayload: any;
    await handlers["context.sync"]({
      params: { since: Date.now() + 1000 },
      respond: (ok, payload) => {
        responsePayload = payload;
      },
    });

    expect(responsePayload.frames).toHaveLength(0);
  });

  it("accepts optional kind and zone filters", async () => {
    worldModel.ingest(makeFrame({
      frameId: "obs-z1",
      kind: "observation",
      timestamp: 100,
      data: { metric: "m", value: 1, zone: "zone-1" },
    }));
    worldModel.ingest(makeFrame({
      frameId: "evt-z1",
      kind: "event",
      timestamp: 200,
      data: { event: "pump", zone: "zone-1" },
    }));
    worldModel.ingest(makeFrame({
      frameId: "obs-z2",
      kind: "observation",
      timestamp: 300,
      data: { metric: "m", value: 2, zone: "zone-2" },
    }));

    let responsePayload: any;
    await handlers["context.sync"]({
      params: { since: 0, kind: "observation", zone: "zone-1" },
      respond: (ok, payload) => {
        responsePayload = payload;
      },
    });

    expect(responsePayload.frames).toHaveLength(1);
    expect(responsePayload.frames[0].frameId).toBe("obs-z1");
  });

  it("handles missing params gracefully", async () => {
    let responded = false;
    await handlers["context.sync"]({
      params: {},
      respond: (ok) => {
        responded = true;
        expect(ok).toBe(true);
      },
    });
    expect(responded).toBe(true);
  });
});
