/**
 * PeerConnectionManager — manages outbound peer connections.
 *
 * Extracted from MeshNodeRuntime to separate:
 *   - Outbound client lifecycle (create, track, stop)
 *   - Connection callbacks (capability updates, auto-connect tracking, context sync)
 *   - Context frame handling from outbound peers
 */

import type { MeshStaticPeer } from "./types.mesh.js";
import type { DeviceIdentity } from "../infra/device-identity.js";
import type { ContextFrame } from "./context-types.js";
import type { PeerSession } from "./types.js";
import { MeshPeerClient } from "./peer-client.js";
import type { PeerRegistry } from "./peer-registry.js";
import type { MeshCapabilityRegistry } from "./capabilities.js";
import type { ContextPropagator } from "./context-propagator.js";
import type { WorldModel } from "./world-model.js";
import type { MeshEventBus } from "./event-bus.js";
import type { AutoConnectManager } from "./auto-connect.js";
import { ingestSyncResponse, calculateSyncSince, type ContextSyncResponse } from "./context-sync.js";
import { ConnectionHealthMonitor } from "./connection-health.js";

// ─── Types ──────────────────────────────────────────────────

export type PeerConnectionManagerDeps = {
  identity: DeviceIdentity;
  displayName?: string;
  capabilities: string[];
  peerRegistry: PeerRegistry;
  capabilityRegistry: MeshCapabilityRegistry;
  contextPropagator: ContextPropagator;
  worldModel: WorldModel;
  eventBus: MeshEventBus;
  autoConnect: AutoConnectManager;
  log: { info: (msg: string) => void; warn: (msg: string) => void };
};

// ─── Manager ────────────────────────────────────────────────

export class PeerConnectionManager {
  private readonly clients = new Map<string, MeshPeerClient>();
  private readonly deps: PeerConnectionManagerDeps;
  readonly connectionHealth = new ConnectionHealthMonitor({
    staleThresholdMs: 90_000, // 90 seconds without activity = stale
    onStaleDetected: (deviceId) => {
      this.deps.log.warn(`mesh: stale connection detected for ${deviceId.slice(0, 12)}…`);
    },
  });

  constructor(deps: PeerConnectionManagerDeps) {
    this.deps = deps;
  }

  /**
   * Connect to a peer. Idempotent — won't create duplicate connections.
   */
  connectToPeer(peer: MeshStaticPeer): void {
    if (this.clients.has(peer.deviceId)) return;

    const client = new MeshPeerClient({
      url: peer.url,
      remoteDeviceId: peer.deviceId,
      identity: this.deps.identity,
      peerRegistry: this.deps.peerRegistry,
      tlsFingerprint: peer.tlsFingerprint,
      displayName: this.deps.displayName,
      capabilities: this.deps.capabilities,
      onConnected: (session) => {
        if (session.capabilities.length > 0) {
          this.deps.capabilityRegistry.updatePeer(session.deviceId, session.capabilities);
        }
        this.deps.autoConnect.markConnected(session.deviceId);
        this.connectionHealth.recordActivity(session.deviceId);
        this.deps.eventBus.emit("peer.connected", { session });
        this.deps.log.info(`mesh: outbound connected ${session.deviceId.slice(0, 12)}…`);
        this.requestContextSync(session.deviceId);
      },
      onDisconnected: (deviceId) => {
        this.deps.capabilityRegistry.removePeer(deviceId);
        this.deps.autoConnect.markDisconnected(deviceId);
        this.connectionHealth.removePeer(deviceId);
        this.deps.eventBus.emit("peer.disconnected", { deviceId, reason: "outbound disconnected" });
        this.deps.log.info(`mesh: outbound disconnected ${deviceId.slice(0, 12)}…`);
      },
      onError: (err) => {
        this.deps.log.warn(`mesh: outbound peer error (${peer.deviceId.slice(0, 12)}…): ${String(err)}`);
      },
      onEvent: (event, payload) => {
        // Record activity for connection health monitoring
        this.connectionHealth.recordActivity(peer.deviceId);

        if (event === "context.frame") {
          const frame = payload as ContextFrame;
          const isNew = this.deps.contextPropagator.handleInbound(frame, peer.deviceId);
          if (isNew) {
            this.deps.worldModel.ingest(frame);
            this.deps.eventBus.emit("context.frame.ingested", { frame });
          }
        }
      },
    });

    this.clients.set(peer.deviceId, client);
    client.start();
  }

  /**
   * Stop all outbound connections.
   */
  stopAll(): void {
    for (const client of this.clients.values()) {
      client.stop();
    }
    this.clients.clear();
  }

  /**
   * Check if there's an outbound connection to a peer.
   */
  has(deviceId: string): boolean {
    return this.clients.has(deviceId);
  }

  /**
   * Get count of active outbound connections.
   */
  get size(): number {
    return this.clients.size;
  }

  /**
   * Request context sync from a connected peer.
   */
  private requestContextSync(peerDeviceId: string): void {
    const recentFrames = this.deps.worldModel.getRecentFrames(1);
    const lastTimestamp = recentFrames.length > 0
      ? recentFrames[recentFrames.length - 1].timestamp
      : null;
    const since = calculateSyncSince(lastTimestamp, 60 * 60 * 1000);

    this.deps.peerRegistry.invoke({
      deviceId: peerDeviceId,
      method: "context.sync",
      params: { since, limit: 50 },
      timeoutMs: 10_000,
    }).then((result) => {
      if (result.ok && result.payload) {
        const response = result.payload as ContextSyncResponse;
        const { ingested, duplicates } = ingestSyncResponse(this.deps.worldModel, response);
        if (ingested > 0) {
          this.deps.log.info(
            `mesh: context sync from ${peerDeviceId.slice(0, 12)}…: ${ingested} new, ${duplicates} dup`,
          );
        }
      }
    }).catch((err) => {
      // Context sync is best-effort — log but don't fail
      this.deps.log.warn(`mesh: context sync failed for ${peerDeviceId.slice(0, 12)}…: ${String(err)}`);
    });
  }
}
