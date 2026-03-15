import { describe, it, expect, beforeEach, vi } from "vitest";
import { UIBroadcaster } from "./ui-broadcaster.js";

const WS_OPEN = 1;
const WS_CLOSED = 3;

function createMockWebSocket(readyState = WS_OPEN) {
  const listeners = new Map<string, Function[]>();
  return {
    readyState,
    sent: [] as string[],
    send(data: string) {
      this.sent.push(data);
    },
    addEventListener(event: string, handler: Function) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
    },
    simulateClose() {
      this.readyState = WS_CLOSED;
      for (const handler of listeners.get("close") ?? []) {
        handler();
      }
    },
  };
}

describe("UIBroadcaster", () => {
  let broadcaster: UIBroadcaster;

  beforeEach(() => {
    broadcaster = new UIBroadcaster();
  });

  it("starts with zero subscribers", () => {
    expect(broadcaster.subscriberCount).toBe(0);
  });

  it("adds a subscriber", () => {
    const ws = createMockWebSocket();
    broadcaster.addSubscriber(ws as any);
    expect(broadcaster.subscriberCount).toBe(1);
  });

  it("broadcasts to all subscribers", () => {
    const ws1 = createMockWebSocket();
    const ws2 = createMockWebSocket();
    broadcaster.addSubscriber(ws1 as any);
    broadcaster.addSubscriber(ws2 as any);

    broadcaster.broadcast("test.event", { data: "hello" });

    expect(ws1.sent).toHaveLength(1);
    expect(ws2.sent).toHaveLength(1);

    const parsed1 = JSON.parse(ws1.sent[0]);
    expect(parsed1.type).toBe("event");
    expect(parsed1.event).toBe("test.event");
    expect(parsed1.payload).toEqual({ data: "hello" });
  });

  it("does not send to closed sockets", () => {
    const open = createMockWebSocket(WS_OPEN);
    const closed = createMockWebSocket(WS_CLOSED);
    broadcaster.addSubscriber(open as any);
    broadcaster.addSubscriber(closed as any);

    broadcaster.broadcast("test", { ok: true });

    expect(open.sent).toHaveLength(1);
    expect(closed.sent).toHaveLength(0);
  });

  it("auto-removes subscriber on close event", () => {
    const ws = createMockWebSocket();
    broadcaster.addSubscriber(ws as any);
    expect(broadcaster.subscriberCount).toBe(1);

    ws.simulateClose();
    expect(broadcaster.subscriberCount).toBe(0);
  });

  it("removeSubscriber removes manually", () => {
    const ws = createMockWebSocket();
    broadcaster.addSubscriber(ws as any);
    broadcaster.removeSubscriber(ws as any);
    expect(broadcaster.subscriberCount).toBe(0);
  });

  it("clear removes all subscribers", () => {
    broadcaster.addSubscriber(createMockWebSocket() as any);
    broadcaster.addSubscriber(createMockWebSocket() as any);
    broadcaster.addSubscriber(createMockWebSocket() as any);

    broadcaster.clear();
    expect(broadcaster.subscriberCount).toBe(0);
  });

  it("handles send failures gracefully", () => {
    const faultyWs = createMockWebSocket();
    faultyWs.send = () => { throw new Error("write failed"); };
    broadcaster.addSubscriber(faultyWs as any);

    // Should not throw
    expect(() => {
      broadcaster.broadcast("test", { ok: true });
    }).not.toThrow();
  });

  it("broadcasts to multiple subscribers independently", () => {
    const ws1 = createMockWebSocket();
    const ws2 = createMockWebSocket();
    const ws3 = createMockWebSocket();

    broadcaster.addSubscriber(ws1 as any);
    broadcaster.addSubscriber(ws2 as any);
    broadcaster.addSubscriber(ws3 as any);

    broadcaster.broadcast("event.1", { seq: 1 });
    broadcaster.broadcast("event.2", { seq: 2 });

    expect(ws1.sent).toHaveLength(2);
    expect(ws2.sent).toHaveLength(2);
    expect(ws3.sent).toHaveLength(2);
  });
});
