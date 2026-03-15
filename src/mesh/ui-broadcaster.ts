/**
 * UIBroadcaster — manages WebSocket UI subscribers and event broadcasting.
 *
 * Extracted from MeshNodeRuntime to separate the UI subscriber management
 * concern from the core mesh protocol logic.
 *
 * Handles:
 *   - Tracking UI WebSocket subscribers (browsers calling chat.subscribe)
 *   - Broadcasting events to all connected UI clients
 *   - Auto-cleanup on disconnect
 */

import type { WebSocket } from "ws";

/** WebSocket.OPEN = 1. */
const WS_OPEN = 1;

export class UIBroadcaster {
  private readonly subscribers = new Set<WebSocket>();

  /**
   * Register a WebSocket as a UI subscriber.
   * Automatically removes it on close.
   */
  addSubscriber(socket: WebSocket): void {
    this.subscribers.add(socket);
    socket.addEventListener("close", () => {
      this.subscribers.delete(socket);
    });
  }

  /**
   * Remove a WebSocket subscriber.
   */
  removeSubscriber(socket: WebSocket): void {
    this.subscribers.delete(socket);
  }

  /**
   * Broadcast an event to all connected UI subscribers.
   */
  broadcast(event: string, payload: unknown): void {
    const msg = JSON.stringify({ type: "event", event, payload });
    for (const ws of this.subscribers) {
      if (ws.readyState === WS_OPEN) {
        try {
          ws.send(msg);
        } catch {
          // Ignore send failures on individual subscribers
        }
      }
    }
  }

  /**
   * Number of active UI subscribers.
   */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /**
   * Remove all subscribers. Used during shutdown.
   */
  clear(): void {
    this.subscribers.clear();
  }
}
