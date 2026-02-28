import { randomUUID } from "node:crypto";
import type { DeviceIdentity } from "../infra/device-identity.js";
import type { PeerRegistry } from "./peer-registry.js";
import type { ContextFrame } from "./context-types.js";
import type { MeshEvidenceSource } from "./types.js";

export class ContextPropagator {
  constructor(
    private deps: {
      identity: DeviceIdentity;
      peerRegistry: PeerRegistry;
      displayName?: string;
      log: { info: (msg: string) => void };
    },
  ) {}

  /**
   * Broadcast a context frame to all connected peers.
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
    };

    this.deps.log.info(
      `[context] Broadcasting ${fullFrame.kind}: ${JSON.stringify(fullFrame.data)}`,
    );

    this.deps.peerRegistry.broadcastEvent("context.frame", fullFrame);
    return fullFrame;
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
