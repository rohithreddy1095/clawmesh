import { describe, it, expect, vi, beforeEach } from "vitest";
import { RpcDispatcher, type RpcHandlerFn } from "./rpc-dispatcher.js";

const WS_OPEN = 1;
const WS_CLOSED = 3;

/** Create a minimal mock WebSocket for testing dispatch. */
function createMockSocket(): any & { sentMessages: string[] } {
  const sentMessages: string[] = [];
  return {
    readyState: WS_OPEN,
    send(data: string) {
      sentMessages.push(data);
    },
    sentMessages,
  };
}

describe("RpcDispatcher", () => {
  let dispatcher: RpcDispatcher;

  beforeEach(() => {
    dispatcher = new RpcDispatcher();
  });

  // ─── Registration ──────────────────────────

  it("register adds a handler", () => {
    const handler: RpcHandlerFn = ({ respond }) => respond(true, { ok: true });
    dispatcher.register("test.method", handler);
    expect(dispatcher.hasHandler("test.method")).toBe(true);
  });

  it("registerAll adds multiple handlers", () => {
    dispatcher.registerAll({
      "method.a": ({ respond }) => respond(true),
      "method.b": ({ respond }) => respond(true),
    });
    expect(dispatcher.hasHandler("method.a")).toBe(true);
    expect(dispatcher.hasHandler("method.b")).toBe(true);
  });

  it("hasHandler returns false for unregistered methods", () => {
    expect(dispatcher.hasHandler("nonexistent")).toBe(false);
  });

  it("listMethods returns all registered method names", () => {
    dispatcher.register("alpha", ({ respond }) => respond(true));
    dispatcher.register("beta", ({ respond }) => respond(true));
    const methods = dispatcher.listMethods();
    expect(methods).toContain("alpha");
    expect(methods).toContain("beta");
    expect(methods).toHaveLength(2);
  });

  // ─── Dispatch ──────────────────────────────

  it("dispatches to the correct handler", async () => {
    const handler = vi.fn(({ respond }: { respond: (ok: boolean, payload?: unknown) => void }) => {
      respond(true, { result: "ok" });
    }) as unknown as RpcHandlerFn;
    dispatcher.register("my.method", handler);

    const socket = createMockSocket();
    await dispatcher.dispatch(socket, "conn-1", {
      type: "req",
      id: "req-1",
      method: "my.method",
      params: { key: "value" },
    });

    expect(handler).toHaveBeenCalledOnce();
    const response = JSON.parse(socket.sentMessages[0]);
    expect(response).toEqual({
      type: "res",
      id: "req-1",
      ok: true,
      payload: { result: "ok" },
    });
  });

  it("returns UNKNOWN_METHOD for unregistered methods", async () => {
    const socket = createMockSocket();
    await dispatcher.dispatch(socket, "conn-1", {
      type: "req",
      id: "req-1",
      method: "nonexistent",
    });

    const response = JSON.parse(socket.sentMessages[0]);
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("UNKNOWN_METHOD");
  });

  it("catches handler errors and returns INTERNAL_ERROR", async () => {
    dispatcher.register("failing", () => {
      throw new Error("handler boom");
    });

    const socket = createMockSocket();
    await dispatcher.dispatch(socket, "conn-1", {
      type: "req",
      id: "req-1",
      method: "failing",
    });

    const response = JSON.parse(socket.sentMessages[0]);
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INTERNAL_ERROR");
    expect(response.error.message).toContain("handler boom");
  });

  it("does not send response if socket is closed", async () => {
    dispatcher.register("test", ({ respond }) => {
      respond(true, { ok: true });
    });

    const socket = createMockSocket();
    (socket as any).readyState = WS_CLOSED;

    await dispatcher.dispatch(socket, "conn-1", {
      type: "req",
      id: "req-1",
      method: "test",
    });

    expect(socket.sentMessages).toHaveLength(0);
  });

  it("passes connId and socket in req object", async () => {
    let capturedReq: Record<string, unknown> = {};
    const handler: RpcHandlerFn = ({ req, respond }) => {
      capturedReq = req;
      respond(true, { connId: req._connId, hasSocket: !!req._socket });
    };
    dispatcher.register("check", handler);

    const socket = createMockSocket();
    await dispatcher.dispatch(socket, "conn-42", {
      type: "req",
      id: "req-1",
      method: "check",
    });

    expect(capturedReq._connId).toBe("conn-42");
    expect(capturedReq._socket).toBe(socket);
  });

  it("passes params to the handler", async () => {
    let capturedParams: Record<string, unknown> = {};
    const handler: RpcHandlerFn = ({ params, respond }) => {
      capturedParams = params;
      respond(true, params);
    };
    dispatcher.register("echo", handler);

    const socket = createMockSocket();
    await dispatcher.dispatch(socket, "conn-1", {
      type: "req",
      id: "req-1",
      method: "echo",
      params: { foo: "bar", count: 42 },
    });

    expect(capturedParams).toEqual({ foo: "bar", count: 42 });
  });

  it("handles async handlers", async () => {
    dispatcher.register("async.method", async ({ respond }) => {
      await new Promise((r) => setTimeout(r, 10));
      respond(true, { async: true });
    });

    const socket = createMockSocket();
    await dispatcher.dispatch(socket, "conn-1", {
      type: "req",
      id: "req-1",
      method: "async.method",
    });

    const response = JSON.parse(socket.sentMessages[0]);
    expect(response.ok).toBe(true);
    expect(response.payload).toEqual({ async: true });
  });
});

describe("RpcDispatcher.parseRequest", () => {
  it("parses valid request", () => {
    const result = RpcDispatcher.parseRequest(
      JSON.stringify({ type: "req", id: "1", method: "test", params: { x: 1 } }),
    );
    expect(result).toEqual({
      type: "req",
      id: "1",
      method: "test",
      params: { x: 1 },
    });
  });

  it("returns null for non-request type", () => {
    expect(
      RpcDispatcher.parseRequest(JSON.stringify({ type: "res", id: "1", ok: true })),
    ).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(RpcDispatcher.parseRequest("not json")).toBeNull();
  });

  it("returns null for missing id", () => {
    expect(
      RpcDispatcher.parseRequest(JSON.stringify({ type: "req", method: "test" })),
    ).toBeNull();
  });

  it("returns null for missing method", () => {
    expect(
      RpcDispatcher.parseRequest(JSON.stringify({ type: "req", id: "1" })),
    ).toBeNull();
  });

  it("provides empty params object when params missing", () => {
    const result = RpcDispatcher.parseRequest(
      JSON.stringify({ type: "req", id: "1", method: "test" }),
    );
    expect(result?.params).toEqual({});
  });
});

describe("RpcDispatcher.parseResponse", () => {
  it("parses valid response", () => {
    const result = RpcDispatcher.parseResponse(
      JSON.stringify({ type: "res", id: "1", ok: true, payload: { data: "ok" } }),
    );
    expect(result).toEqual({
      type: "res",
      id: "1",
      ok: true,
      payload: { data: "ok" },
      error: null,
    });
  });

  it("parses error response", () => {
    const result = RpcDispatcher.parseResponse(
      JSON.stringify({
        type: "res",
        id: "1",
        ok: false,
        error: { code: "ERR", message: "failed" },
      }),
    );
    expect(result?.ok).toBe(false);
    expect(result?.error).toEqual({ code: "ERR", message: "failed" });
  });

  it("returns null for non-response", () => {
    expect(
      RpcDispatcher.parseResponse(JSON.stringify({ type: "req", id: "1", method: "test" })),
    ).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(RpcDispatcher.parseResponse("nope")).toBeNull();
  });

  it("returns null for missing ok field", () => {
    expect(
      RpcDispatcher.parseResponse(JSON.stringify({ type: "res", id: "1" })),
    ).toBeNull();
  });
});
