import { describe, it, expect } from "vitest";
import {
  MockTransport,
  TransportState,
  WebSocketTransport,
} from "./transport.js";

describe("MockTransport", () => {
  it("starts in OPEN state", () => {
    const t = new MockTransport();
    expect(t.readyState).toBe(TransportState.OPEN);
    expect(t.closed).toBe(false);
  });

  it("records sent messages", () => {
    const t = new MockTransport();
    t.send("hello");
    t.send("world");
    expect(t.sent).toEqual(["hello", "world"]);
  });

  it("throws when sending on non-OPEN transport", () => {
    const t = new MockTransport();
    t.setReadyState(TransportState.CLOSED);
    expect(() => t.send("fail")).toThrow("Transport is not open");
  });

  it("close() sets state to CLOSED", () => {
    const t = new MockTransport();
    t.close(1000, "normal");
    expect(t.readyState).toBe(TransportState.CLOSED);
    expect(t.closed).toBe(true);
    expect(t.closeCode).toBe(1000);
    expect(t.closeReason).toBe("normal");
  });

  it("lastSentJSON parses the most recent message", () => {
    const t = new MockTransport();
    t.send(JSON.stringify({ type: "req", id: "1" }));
    t.send(JSON.stringify({ type: "res", id: "2" }));
    const last = t.lastSentJSON<{ type: string; id: string }>();
    expect(last?.type).toBe("res");
    expect(last?.id).toBe("2");
  });

  it("lastSentJSON returns null when no messages", () => {
    const t = new MockTransport();
    expect(t.lastSentJSON()).toBeNull();
  });

  it("allSentJSON parses all messages", () => {
    const t = new MockTransport();
    t.send(JSON.stringify({ a: 1 }));
    t.send(JSON.stringify({ b: 2 }));
    const all = t.allSentJSON<{ a?: number; b?: number }>();
    expect(all).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("clearSent empties the history", () => {
    const t = new MockTransport();
    t.send("msg1");
    t.send("msg2");
    t.clearSent();
    expect(t.sent).toEqual([]);
  });

  it("setReadyState allows simulating connection states", () => {
    const t = new MockTransport();
    t.setReadyState(TransportState.CONNECTING);
    expect(t.readyState).toBe(TransportState.CONNECTING);
    expect(() => t.send("fail")).toThrow();

    t.setReadyState(TransportState.OPEN);
    expect(() => t.send("ok")).not.toThrow();
  });
});

describe("TransportState", () => {
  it("has correct WebSocket-compatible values", () => {
    expect(TransportState.CONNECTING).toBe(0);
    expect(TransportState.OPEN).toBe(1);
    expect(TransportState.CLOSING).toBe(2);
    expect(TransportState.CLOSED).toBe(3);
  });
});

describe("WebSocketTransport", () => {
  it("exists as an exported class", () => {
    expect(WebSocketTransport).toBeDefined();
    expect(typeof WebSocketTransport).toBe("function");
  });
});
