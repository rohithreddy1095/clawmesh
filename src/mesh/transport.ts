/**
 * Transport abstraction — decouples peer communication from WebSocket.
 *
 * PeerSession uses Transport instead of raw WebSocket references.
 * This allows:
 *   - MockTransport for testing without real WebSockets
 *   - Future alternative transports (TCP, QUIC, unix sockets)
 *   - Easier unit testing of PeerRegistry, forwarding, etc.
 */

import { WebSocket } from "ws";

// ─── Transport Interface ────────────────────────────────────

/** Ready state constants matching WebSocket API. */
export const TransportState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export type TransportReadyState = (typeof TransportState)[keyof typeof TransportState];

/**
 * Minimal transport interface for peer-to-peer communication.
 * Any transport that can send string data and report its state qualifies.
 */
export interface Transport {
  /** Current connection state. */
  readonly readyState: TransportReadyState;

  /** Send a string payload to the remote peer. Throws if not open. */
  send(data: string): void;

  /** Gracefully close the connection. */
  close(code?: number, reason?: string): void;
}

// ─── WebSocket Adapter ──────────────────────────────────────

/**
 * Wraps a WebSocket instance as a Transport.
 * This is the default transport used in production.
 */
export class WebSocketTransport implements Transport {
  constructor(private readonly ws: WebSocket) {}

  get readyState(): TransportReadyState {
    return this.ws.readyState as TransportReadyState;
  }

  send(data: string): void {
    this.ws.send(data);
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason);
  }

  /** Access the underlying WebSocket for event listeners. */
  get raw(): WebSocket {
    return this.ws;
  }
}

// ─── Mock Transport ─────────────────────────────────────────

/**
 * In-memory transport for testing. Records sent messages and allows
 * programmatic state control.
 */
export class MockTransport implements Transport {
  /** All messages sent via this transport, in order. */
  readonly sent: string[] = [];
  /** Whether close() has been called. */
  closed = false;
  /** The close code, if close() was called with one. */
  closeCode?: number;
  /** The close reason, if close() was called with one. */
  closeReason?: string;

  private _readyState: TransportReadyState = TransportState.OPEN;

  get readyState(): TransportReadyState {
    return this._readyState;
  }

  /** Simulate state change (for testing disconnections etc.) */
  setReadyState(state: TransportReadyState): void {
    this._readyState = state;
  }

  send(data: string): void {
    if (this._readyState !== TransportState.OPEN) {
      throw new Error("Transport is not open");
    }
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
    this._readyState = TransportState.CLOSED;
  }

  /** Get the last sent message, parsed as JSON. */
  lastSentJSON<T = unknown>(): T | null {
    if (this.sent.length === 0) return null;
    return JSON.parse(this.sent[this.sent.length - 1]) as T;
  }

  /** Get all sent messages parsed as JSON. */
  allSentJSON<T = unknown>(): T[] {
    return this.sent.map((s) => JSON.parse(s) as T);
  }

  /** Clear the sent message history. */
  clearSent(): void {
    this.sent.length = 0;
  }
}
