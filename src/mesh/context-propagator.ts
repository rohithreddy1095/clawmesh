import { randomUUID } from "node:crypto";
import type { DeviceIdentity } from "../infra/device-identity.js";
import type { PeerRegistry } from "./peer-registry.js";
import type { ContextFrame } from "./context-types.js";
import type { MeshEvidenceSource } from "./types.js";

/**
 * Maximum number of hops a context frame will be re-propagated through the mesh.
 * After this many hops, the frame is ingested locally but not forwarded further.
 */
const MAX_GOSSIP_HOPS = 3;

export class ContextPropagator {
  /** Frame IDs we have already seen — prevents re-broadcasting duplicates. */
  private seenFrameIds = new Set<string>();
  private maxSeenIds: number;

  constructor(
    private deps: {
      identity: DeviceIdentity;
      peerRegistry: PeerRegistry;
      displayName?: string;
      log: { info: (msg: string) => void };
      maxSeenIds?: number;
    },
  ) {
    this.maxSeenIds = deps.maxSeenIds ?? 5000;
  }

  /**
   * Broadcast a locally-originated context frame to all connected peers.
   * Sets hop count to 0 (this node originated the frame).
   */
  broadcast(
    frame: Omit<ContextFrame, "frameId" | "sourceDeviceId" | "timestamp">,
  ): ContextFrame {
    const fullFrame: ContextFrame = {
      ...frame,
      frameId: randomUUID(),
      sourceDeviceId: this.deps.identity.deviceId,
      sourceDisplayName: frame.sourceDisplayName ?? this.deps.displayName,
      timestamp: Date.now(),
      hops: 0,
    };

    this.deps.log.info(
      `[context] Broadcasting ${fullFrame.kind}: ${JSON.stringify(fullFrame.data)}`,
    );

    this.markSeen(fullFrame.frameId);
    this.deps.peerRegistry.broadcastEvent("context.frame", fullFrame);
    return fullFrame;
  }

  /**
   * Handle an inbound context frame from a peer.
   * Returns true if the frame was new and should be ingested.
   * Re-propagates the frame to other peers if within hop limit.
   */
  handleInbound(frame: ContextFrame, fromDeviceId: string): boolean {
    // Deduplicate: skip if we've already seen this frame
    if (this.seenFrameIds.has(frame.frameId)) {
      return false;
    }

    // Skip frames we originated ourselves
    if (frame.sourceDeviceId === this.deps.identity.deviceId) {
      this.markSeen(frame.frameId);
      return false;
    }

    this.markSeen(frame.frameId);

    // Re-propagate (gossip) to other peers if within hop limit
    const currentHops = frame.hops ?? 0;
    if (currentHops < MAX_GOSSIP_HOPS) {
      const gossipFrame: ContextFrame = {
        ...frame,
        hops: currentHops + 1,
      };

      // Forward to all peers except the one who sent it to us
      for (const peer of this.deps.peerRegistry.listConnected()) {
        if (peer.deviceId === fromDeviceId) continue;
        this.deps.peerRegistry.sendEvent(peer.deviceId, "context.frame", gossipFrame);
      }
    }

    return true;
  }

  private markSeen(frameId: string): void {
    this.seenFrameIds.add(frameId);
    // Trim to prevent unbounded growth
    if (this.seenFrameIds.size > this.maxSeenIds) {
      const ids = [...this.seenFrameIds];
      this.seenFrameIds = new Set(ids.slice(-Math.floor(this.maxSeenIds * 0.75)));
    }
  }

  /**
   * Create a sensor observation frame and broadcast it.
   */
  broadcastObservation(params: {
    data: Record<string, unknown>;
    evidenceSources?: MeshEvidenceSource[];
    note?: string;
  }): ContextFrame {
    return this.broadcast({
      kind: "observation",
      data: params.data,
      trust: {
        evidence_sources: params.evidenceSources ?? ["sensor"],
        evidence_trust_tier: "T2_operational_observation",
      },
      note: params.note,
    });
  }

  /**
   * Create a human input frame and broadcast it.
   */
  broadcastHumanInput(params: {
    data: Record<string, unknown>;
    note?: string;
  }): ContextFrame {
    return this.broadcast({
      kind: "human_input",
      data: params.data,
      trust: {
        evidence_sources: ["human"],
        evidence_trust_tier: "T3_verified_action_evidence",
      },
      note: params.note,
    });
  }

  /**
   * Create an inference frame (LLM-derived conclusion) and broadcast it.
   */
  broadcastInference(params: {
    data: Record<string, unknown>;
    note?: string;
  }): ContextFrame {
    return this.broadcast({
      kind: "inference",
      data: params.data,
      trust: {
        evidence_sources: ["llm"],
        evidence_trust_tier: "T0_planning_inference",
      },
      note: params.note,
    });
  }
}
