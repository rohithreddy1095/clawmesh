/**
 * RPC Dispatcher — handles JSON-RPC-like request/response dispatch.
 *
 * Extracted from MeshNodeRuntime to separate concerns:
 * - RPC frame parsing and validation
 * - Method routing to registered handlers
 * - Response serialization
 *
 * The runtime registers handlers; the dispatcher routes requests to them.
 */

import type { WebSocket } from "ws";

/** WebSocket.OPEN = 1. Using the constant directly avoids requiring ws at runtime. */
const WS_OPEN = 1;

// ─── RPC Frame Types ────────────────────────────────────────

export type RpcRequestFrame = {
  type: "req";
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

export type RpcResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code?: string; message?: string } | null;
};

export type RpcHandlerFn = (opts: {
  req: Record<string, unknown>;
  params: Record<string, unknown>;
  respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void;
  client?: unknown;
  isWebchatConnect?: () => boolean;
  context?: unknown;
}) => void | Promise<void>;

export type RpcHandlerMap = Record<string, RpcHandlerFn>;

// ─── Dispatcher ─────────────────────────────────────────────

export class RpcDispatcher {
  private readonly handlers: RpcHandlerMap = {};

  /**
   * Register a handler for an RPC method.
   */
  register(method: string, handler: RpcHandlerFn): void {
    this.handlers[method] = handler;
  }

  /**
   * Register multiple handlers at once.
   */
  registerAll(handlers: RpcHandlerMap): void {
    for (const [method, handler] of Object.entries(handlers)) {
      this.handlers[method] = handler;
    }
  }

  /**
   * Check if a method has a registered handler.
   */
  hasHandler(method: string): boolean {
    return method in this.handlers;
  }

  /**
   * List all registered method names.
   */
  listMethods(): string[] {
    return Object.keys(this.handlers);
  }

  /**
   * Dispatch an RPC request to the appropriate handler.
   * Sends the response back via the socket.
   */
  async dispatch(
    socket: WebSocket,
    connId: string,
    frame: RpcRequestFrame,
  ): Promise<void> {
    const respond = (
      ok: boolean,
      payload?: unknown,
      error?: { code: string; message: string },
    ) => {
      if (socket.readyState !== WS_OPEN) {
        return;
      }
      const response: RpcResponseFrame = {
        type: "res",
        id: frame.id,
        ok,
        payload,
        error,
      };
      socket.send(JSON.stringify(response));
    };

    const handler = this.handlers[frame.method];
    if (!handler) {
      respond(false, undefined, {
        code: "UNKNOWN_METHOD",
        message: `unknown method: ${frame.method}`,
      });
      return;
    }

    try {
      await handler({
        req: {
          id: frame.id,
          method: frame.method,
          params: frame.params ?? {},
          _connId: connId,
          _socket: socket,
        },
        params: frame.params ?? {},
        client: null,
        isWebchatConnect: () => false,
        context: {},
        respond,
      });
    } catch (err) {
      respond(false, undefined, {
        code: "INTERNAL_ERROR",
        message: String(err),
      });
    }
  }

  /**
   * Try to parse a raw JSON string as an RPC request frame.
   * Returns null if not a valid request.
   */
  static parseRequest(raw: string): RpcRequestFrame | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== "object") return null;
    const frame = parsed as Record<string, unknown>;

    if (frame.type !== "req") return null;
    if (typeof frame.id !== "string") return null;
    if (typeof frame.method !== "string") return null;

    return {
      type: "req",
      id: frame.id,
      method: frame.method,
      params:
        frame.params && typeof frame.params === "object"
          ? (frame.params as Record<string, unknown>)
          : {},
    };
  }

  /**
   * Try to parse a raw JSON string as an RPC response frame.
   * Returns null if not a valid response.
   */
  static parseResponse(raw: string): RpcResponseFrame | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== "object") return null;
    const frame = parsed as Record<string, unknown>;

    if (frame.type !== "res") return null;
    if (typeof frame.id !== "string") return null;
    if (typeof frame.ok !== "boolean") return null;

    return {
      type: "res",
      id: frame.id,
      ok: frame.ok,
      payload: frame.payload,
      error:
        frame.error && typeof frame.error === "object"
          ? (frame.error as { code?: string; message?: string })
          : null,
    };
  }
}
