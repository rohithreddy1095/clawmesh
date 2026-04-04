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
import type { MeshNodeRole, PeerSession } from "./types.js";
import type { TaskProposal } from "../agents/types.js";
import { MeshPeerClient } from "./peer-client.js";
import type { PeerRegistry } from "./peer-registry.js";
import type { MeshCapabilityRegistry } from "./capabilities.js";
import type { ContextPropagator } from "./context-propagator.js";
import type { WorldModel } from "./world-model.js";
import type { MeshEventBus } from "./event-bus.js";
import type { AutoConnectManager } from "./auto-connect.js";
import { ingestSyncResponse, calculateSyncSince, type ContextSyncResponse } from "./context-sync.js";
import { ConnectionHealthMonitor } from "./connection-health.js";
import { NODE_PROTOCOL_GENERATION } from "./protocol.js";
import { getMeshStaticPeerSecurityPosture, normalizeMeshPeerUrl, requiresPinnedWanTransport } from "./peer-url.js";

// ─── Types ──────────────────────────────────────────────────

export type PeerConnectionManagerDeps = {
  identity: DeviceIdentity;
  displayName?: string;
  capabilities: string[];
  meshId?: string;
  role?: MeshNodeRole;
  peerRegistry: PeerRegistry;
  capabilityRegistry: MeshCapabilityRegistry;
  contextPropagator: ContextPropagator;
  worldModel: WorldModel;
  eventBus: MeshEventBus;
  autoConnect: AutoConnectManager;
  /** Best-effort probe used before honoring a peer.down report. */
  confirmPeerReachable?: (deviceId: string) => Promise<boolean>;
  log: { info: (msg: string) => void; warn: (msg: string) => void };
};

// ─── Manager ────────────────────────────────────────────────

export class PeerConnectionManager {
  private readonly clients = new Map<string, MeshPeerClient>();
  private readonly deps: PeerConnectionManagerDeps;
  private healthTimer?: ReturnType<typeof setInterval>;
  readonly connectionHealth = new ConnectionHealthMonitor({
    staleThresholdMs: 90_000, // 90 seconds without activity = stale
    onStaleDetected: (deviceId) => {
      this.deps.log.warn(`mesh: stale connection detected for ${deviceId.slice(0, 12)}…`);
    },
  });

  constructor(deps: PeerConnectionManagerDeps) {
    this.deps = deps;
    // Periodic health check every 30 seconds
    this.healthTimer = setInterval(() => {
      this.connectionHealth.checkAll();
    }, 30_000);
    this.healthTimer.unref(); // Don't keep process alive
  }

  /**
   * Connect to a peer. Idempotent — won't create duplicate connections.
   */
  connectToPeer(peer: MeshStaticPeer): void {
    if (this.clients.has(peer.deviceId)) return;

    const normalizedUrl = normalizeMeshPeerUrl(peer.url);
    const securityPosture = getMeshStaticPeerSecurityPosture(peer);
    const transportContext = [
      normalizedUrl,
      peer.transportLabel ? `via ${peer.transportLabel}` : undefined,
      `(${securityPosture})`,
    ].filter(Boolean).join(" ");

    if (requiresPinnedWanTransport(peer) && securityPosture === "insecure") {
      this.deps.log.warn(
        `mesh: refusing insecure ${peer.transportLabel} connection ${peer.deviceId.slice(0, 12)}… ${transportContext}`,
      );
      return;
    }
    if (requiresPinnedWanTransport(peer) && securityPosture === "tls-unpinned") {
      this.deps.log.warn(
        `mesh: refusing unpinned ${peer.transportLabel} connection ${peer.deviceId.slice(0, 12)}… ${transportContext}`,
      );
      return;
    }

    this.deps.log.info(`mesh: outbound connecting ${peer.deviceId.slice(0, 12)}… ${transportContext}`);

    const client = new MeshPeerClient({
      url: normalizedUrl,
      remoteDeviceId: peer.deviceId,
      identity: this.deps.identity,
      peerRegistry: this.deps.peerRegistry,
      tlsFingerprint: peer.tlsFingerprint,
      transportLabel: peer.transportLabel,
      displayName: this.deps.displayName,
      capabilities: this.deps.capabilities,
      meshId: this.deps.meshId,
      role: this.deps.role,
      onConnected: (session) => {
        if (session.role !== "viewer" && session.capabilities.length > 0) {
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
        this.deps.autoConnect.markDead(deviceId);
        this.connectionHealth.removePeer(deviceId);
        this.deps.eventBus.emit("peer.disconnected", { deviceId, reason: "outbound disconnected" });
        this.deps.peerRegistry.broadcastEvent("peer.down", {
          gen: NODE_PROTOCOL_GENERATION,
          deviceId,
          reportedAtMs: Date.now(),
        });
        this.deps.log.info(`mesh: outbound disconnected ${deviceId.slice(0, 12)}…`);
      },
      onError: (err) => {
        this.deps.log.warn(
          `mesh: outbound peer error (${peer.deviceId.slice(0, 12)}… ${transportContext}): ${String(err)}`,
        );
      },
      onEvent: async (event, payload) => {
        // Record activity for connection health monitoring
        this.connectionHealth.recordActivity(peer.deviceId);

        if (event === "peer.leaving") {
          if (
            payload && typeof payload === "object" &&
            typeof (payload as { gen?: unknown }).gen === "number" &&
            (payload as { gen: number }).gen !== NODE_PROTOCOL_GENERATION
          ) {
            return;
          }
          const removed = this.deps.peerRegistry.unregisterDevice(peer.deviceId);
          if (removed) {
            this.deps.capabilityRegistry.removePeer(peer.deviceId);
            this.deps.autoConnect.markDisconnected(peer.deviceId);
            this.connectionHealth.removePeer(peer.deviceId);
            this.deps.eventBus.emit("peer.disconnected", { deviceId: peer.deviceId, reason: "peer leaving" });
            this.deps.log.info(`mesh: peer leaving ${peer.deviceId.slice(0, 12)}…`);
          }
          return;
        }

        if (event === "peer.down") {
          if (
            payload && typeof payload === "object" &&
            typeof (payload as { gen?: unknown }).gen === "number" &&
            (payload as { gen: number }).gen !== NODE_PROTOCOL_GENERATION
          ) {
            return;
          }
          const targetDeviceId =
            payload && typeof payload === "object" && typeof (payload as { deviceId?: unknown }).deviceId === "string"
              ? (payload as { deviceId: string }).deviceId
              : undefined;
          if (!targetDeviceId || targetDeviceId === this.deps.identity.deviceId) {
            return;
          }

          const reachable = this.deps.confirmPeerReachable
            ? await this.deps.confirmPeerReachable(targetDeviceId)
            : false;
          if (reachable) {
            this.deps.log.info(
              `mesh: ignoring peer.down for ${targetDeviceId.slice(0, 12)}… — peer still reachable`,
            );
            return;
          }

          const removed = this.deps.peerRegistry.unregisterDevice(targetDeviceId);
          if (removed) {
            this.deps.capabilityRegistry.removePeer(targetDeviceId);
            this.deps.autoConnect.markDead(targetDeviceId);
            this.connectionHealth.removePeer(targetDeviceId);
            this.deps.eventBus.emit("peer.disconnected", { deviceId: targetDeviceId, reason: "peer down" });
            this.deps.log.info(`mesh: peer down ${targetDeviceId.slice(0, 12)}… (reported by ${peer.deviceId.slice(0, 12)}…)`);
          }
          return;
        }

        if (event === "planner.proposal") {
          this.deps.eventBus.emit("proposal.created", { proposal: payload as TaskProposal });
          return;
        }

        if (event === "planner.proposal.resolved") {
          this.deps.eventBus.emit("proposal.resolved", { proposal: payload as TaskProposal });
          return;
        }

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
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = undefined;
    }
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
