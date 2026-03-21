/**
 * Tests for mesh.trace RPC handler.
 */

import { describe, it, expect } from "vitest";
import { createTraceHandlers } from "./trace-rpc.js";
import { CorrelationTracker } from "./correlation-tracker.js";

function callHandler(handler: any, params: Record<string, unknown> = {}) {
  let response: any = null;
  handler({
    req: {},
    params,
    respond: (ok: boolean, payload: unknown) => { response = { ok, payload }; },
  });
  return response;
}

describe("mesh.trace RPC", () => {
  it("returns chain by frameId", () => {
    const tracker = new CorrelationTracker();
    tracker.start("f-001", "sensor", "moisture=12");
    tracker.addStep("f-001", "threshold", "breach detected");

    const handlers = createTraceHandlers({ correlationTracker: tracker });
    const result = callHandler(handlers["mesh.trace"], { frameId: "f-001" });

    expect(result.ok).toBe(true);
    expect(result.payload.chain.steps).toHaveLength(2);
    expect(result.payload.formatted).toContain("[sensor]");
  });

  it("returns null for unknown frameId", () => {
    const handlers = createTraceHandlers({ correlationTracker: new CorrelationTracker() });
    const result = callHandler(handlers["mesh.trace"], { frameId: "unknown" });
    expect(result.payload.chain).toBeNull();
  });

  it("finds chains by stage", () => {
    const tracker = new CorrelationTracker();
    tracker.start("f-001", "sensor", "reading 1");
    tracker.addStep("f-001", "proposal.created", "irrigate");
    tracker.start("f-002", "sensor", "reading 2");

    const handlers = createTraceHandlers({ correlationTracker: tracker });
    const result = callHandler(handlers["mesh.trace"], { stage: "proposal.created" });

    expect(result.payload.chains).toHaveLength(1);
    expect(result.payload.chains[0].originId).toBe("f-001");
  });

  it("returns summary with no params", () => {
    const tracker = new CorrelationTracker();
    tracker.start("f-1", "s", "d");
    tracker.start("f-2", "s", "d");

    const handlers = createTraceHandlers({ correlationTracker: tracker });
    const result = callHandler(handlers["mesh.trace"], {});

    expect(result.payload.trackedChains).toBe(2);
  });
});
