/**
 * Inbound connection handler — manages WebSocket connection lifecycle
 * for incoming peer connections.
 *
 * Extracted from MeshNodeRuntime.start() for testability.
 */

import type { WebSocket } from "ws";
import type { PeerRegistry } from "./peer-registry.js";
import type { MeshCapabilityRegistry } from "./capabilities.js";
import type { MeshEventBus } from "./event-bus.js";
import type { UIBroadcaster } from "./ui-broadcaster.js";

export interface InboundConnectionDeps {
  peerRegistry: PeerRegistry;
  capabilityRegistry: MeshCapabilityRegistry;
  eventBus: MeshEventBus;
  uiBroadcaster: UIBroadcaster;
  /** Called when a message arrives on the socket. */
  onMessage: (socket: WebSocket, connId: string, raw: string) => void;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
  };
}

export interface InboundConnectionTracker {
  /** Track a new inbound connection. */
  add(socket: WebSocket, connId: string): void;
  /** Remove a connection on close. */
  remove(socket: WebSocket): void;
  /** Close all tracked connections (for shutdown). */
  closeAll(): void;
  /** Number of tracked connections. */
  readonly size: number;
}

/**
 * Create a tracker for inbound socket → connId mapping.
 */
export function createConnectionTracker(): InboundConnectionTracker {
  const socketMap = new Map<WebSocket, string>();

  return {
    add(socket, connId) {
      socketMap.set(socket, connId);
    },
    remove(socket) {
      socketMap.delete(socket);
    },
    closeAll() {
      for (const socket of socketMap.keys()) {
        try {
          socket.close();
        } catch {
          // ignore close failures
        }
      }
      socketMap.clear();
    },
    get size() {
      return socketMap.size;
    },
  };
}

/**
 * Handle a disconnect event from an inbound peer socket.
 * Cleans up all registries and emits appropriate events.
 *
 * Returns the disconnected device ID, or null if the socket wasn't a registered peer.
 */
export function handleInboundDisconnect(
  connId: string,
  deps: Pick<InboundConnectionDeps, "peerRegistry" | "capabilityRegistry" | "eventBus" | "log">,
): string | null {
  const deviceId = deps.peerRegistry.unregister(connId);
  if (deviceId) {
    deps.capabilityRegistry.removePeer(deviceId);
    deps.eventBus.emit("peer.disconnected", { deviceId, reason: "socket closed" });
    deps.log.info(`mesh: inbound peer disconnected ${deviceId.slice(0, 12)}…`);
  }
  return deviceId;
}
