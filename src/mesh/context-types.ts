import type { MeshEvidenceSource, MeshTrustTier } from "./types.js";

export type ContextFrameKind =
  | "observation" // Sensor readings, measurements
  | "event" // Task completed, state change
  | "human_input" // Operator commands, notes
  | "inference" // LLM-derived conclusions
  | "capability_update"; // Node capabilities changed

export type ContextFrame = {
  kind: ContextFrameKind;
  /** Unique ID for deduplication. */
  frameId: string;
  /** Device ID of the node that created this context. */
  sourceDeviceId: string;
  /** Human-readable name of the source node. */
  sourceDisplayName?: string;
  /** When this was observed (ms since epoch). */
  timestamp: number;

  /** The actual observation/fact — arbitrary structured data. */
  data: Record<string, unknown>;

  /** Trust metadata (evidence source, tier). */
  trust: {
    evidence_sources: MeshEvidenceSource[];
    evidence_trust_tier: MeshTrustTier;
  };

  /** Optional human-readable note. */
  note?: string;

  /** Number of gossip hops this frame has traversed (0 = originated here). */
  hops?: number;
};
