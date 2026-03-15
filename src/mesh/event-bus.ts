/**
 * MeshEventBus — typed event emitter for decoupling mesh components.
 *
 * Instead of direct method calls (runtime.broadcastToUI, WorldModel.onIngest),
 * components publish events and subscribe independently. This allows N consumers
 * per event type with zero modification to producers.
 *
 * Usage:
 *   const bus = new MeshEventBus();
 *   bus.on("context.frame.ingested", (frame) => { ... });
 *   bus.emit("context.frame.ingested", frame);
 */

import { EventEmitter } from "node:events";
import type { ContextFrame } from "./context-types.js";
import type { PeerSession } from "./types.js";
import type { TaskProposal } from "../agents/types.js";

// ─── Event Map ──────────────────────────────────────────────

/**
 * All mesh events with their payload types.
 * Adding a new event is a one-line addition here.
 */
export interface MeshEventMap {
  // ─── Peer lifecycle ────────────────────────────
  /** A peer completed handshake and is registered. */
  "peer.connected": { session: PeerSession };
  /** A peer disconnected (inbound or outbound). */
  "peer.disconnected": { deviceId: string; reason?: string };

  // ─── Context flow ──────────────────────────────
  /** A new context frame was ingested into the world model. */
  "context.frame.ingested": { frame: ContextFrame };
  /** A locally-originated frame was broadcast to peers. */
  "context.frame.broadcast": { frame: ContextFrame };

  // ─── Intelligence ──────────────────────────────
  /** An operator sent a natural language intent. */
  "operator.intent": {
    text: string;
    conversationId?: string;
    requestId?: string;
    source: string;
  };
  /** A threshold rule was breached. */
  "threshold.breach": {
    ruleId: string;
    metric: string;
    value: number;
    zone?: string;
    promptHint: string;
    frame: ContextFrame;
  };

  // ─── Proposals ─────────────────────────────────
  /** A new task proposal was created. */
  "proposal.created": { proposal: TaskProposal };
  /** A proposal was resolved (approved, rejected, completed, failed). */
  "proposal.resolved": { proposal: TaskProposal };

  // ─── UI ────────────────────────────────────────
  /** Broadcast an event to all UI WebSocket subscribers. */
  "ui.broadcast": { event: string; payload: unknown };

  // ─── System ────────────────────────────────────
  /** Node runtime started. */
  "runtime.started": { host: string; port: number };
  /** Node runtime stopping. */
  "runtime.stopping": {};
}

// ─── Type helpers ───────────────────────────────────────────

export type MeshEventName = keyof MeshEventMap;
export type MeshEventPayload<K extends MeshEventName> = MeshEventMap[K];
export type MeshEventHandler<K extends MeshEventName> = (payload: MeshEventMap[K]) => void;

// ─── MeshEventBus ───────────────────────────────────────────

export class MeshEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Allow many listeners — mesh has many consumers per event
    this.emitter.setMaxListeners(50);
  }

  /**
   * Subscribe to a typed mesh event.
   * Returns a cleanup function for easy unsubscribe.
   */
  on<K extends MeshEventName>(event: K, handler: MeshEventHandler<K>): () => void {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
    return () => {
      this.emitter.off(event, handler as (...args: unknown[]) => void);
    };
  }

  /**
   * Subscribe to a typed mesh event — fires once then auto-unsubscribes.
   */
  once<K extends MeshEventName>(event: K, handler: MeshEventHandler<K>): () => void {
    this.emitter.once(event, handler as (...args: unknown[]) => void);
    return () => {
      this.emitter.off(event, handler as (...args: unknown[]) => void);
    };
  }

  /**
   * Emit a typed mesh event to all subscribers.
   */
  emit<K extends MeshEventName>(event: K, payload: MeshEventMap[K]): void {
    this.emitter.emit(event, payload);
  }

  /**
   * Remove all listeners for a specific event, or all events if none specified.
   */
  removeAllListeners(event?: MeshEventName): void {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
  }

  /**
   * Get the number of listeners for a specific event.
   */
  listenerCount(event: MeshEventName): number {
    return this.emitter.listenerCount(event);
  }
}
