/**
 * Tests for mesh.events RPC handler.
 */

import { describe, it, expect } from "vitest";
import { createEventsHandlers } from "./events-rpc.js";
import { SystemEventLog } from "./system-event-log.js";

function callHandler(handler: any, params: Record<string, unknown> = {}) {
  let response: any = null;
  handler({
    req: {},
    params,
    respond: (ok: boolean, payload: unknown) => { response = { ok, payload }; },
  });
  return response;
}

describe("mesh.events RPC", () => {
  it("returns recent events", () => {
    const log = new SystemEventLog();
    log.record("startup", "Node started");
    log.record("peer.connect", "Connected");

    const handlers = createEventsHandlers({ eventLog: log });
    const result = callHandler(handlers["mesh.events"]);

    expect(result.ok).toBe(true);
    expect(result.payload.events).toHaveLength(2);
    expect(result.payload.total).toBe(2);
  });

  it("filters by event type", () => {
    const log = new SystemEventLog();
    log.record("error", "Bad thing");
    log.record("peer.connect", "Good thing");
    log.record("error", "Another bad thing");

    const handlers = createEventsHandlers({ eventLog: log });
    const result = callHandler(handlers["mesh.events"], { type: "error" });

    expect(result.payload.events).toHaveLength(2);
    expect(result.payload.events.every((e: any) => e.type === "error")).toBe(true);
  });

  it("respects limit parameter", () => {
    const log = new SystemEventLog();
    for (let i = 0; i < 100; i++) log.record("error", `Error ${i}`);

    const handlers = createEventsHandlers({ eventLog: log });
    const result = callHandler(handlers["mesh.events"], { limit: 5 });

    expect(result.payload.events).toHaveLength(5);
  });

  it("clamps limit to 200", () => {
    const log = new SystemEventLog();
    for (let i = 0; i < 300; i++) log.record("error", `Error ${i}`);

    const handlers = createEventsHandlers({ eventLog: log });
    const result = callHandler(handlers["mesh.events"], { limit: 999 });

    expect(result.payload.events.length).toBeLessThanOrEqual(200);
  });

  it("includes 1-hour summary", () => {
    const log = new SystemEventLog();
    log.record("error", "Bad");
    log.record("peer.connect", "Connect");

    const handlers = createEventsHandlers({ eventLog: log });
    const result = callHandler(handlers["mesh.events"]);

    expect(result.payload.summary).toHaveProperty("total");
    expect(result.payload.summary).toHaveProperty("errors");
    expect(result.payload.summary).toHaveProperty("peerChanges");
  });

  it("returns empty for fresh log", () => {
    const log = new SystemEventLog();
    const handlers = createEventsHandlers({ eventLog: log });
    const result = callHandler(handlers["mesh.events"]);

    expect(result.payload.events).toHaveLength(0);
    expect(result.payload.total).toBe(0);
  });
});
