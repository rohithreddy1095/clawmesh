/**
 * Context Sync Protocol — anti-entropy mechanism for mesh world models.
 *
 * When a node joins the mesh (or reboots), it has an empty world model.
 * The context sync protocol allows it to request recent frames from peers,
 * bringing it up to speed without waiting for new observations.
 *
 * Protocol:
 *   1. Joining node sends context.sync request with { since: timestamp }
 *   2. Peer responds with frames newer than that timestamp
 *   3. Joining node ingests frames (WorldModel deduplicates by frameId)
 *
 * This is the classic "anti-entropy" pattern from gossip protocol literature.
 */

import type { ContextFrame } from "./context-types.js";
import type { WorldModel } from "./world-model.js";

// ─── Types ──────────────────────────────────────────────────

export type ContextSyncRequest = {
  /** Only return frames newer than this timestamp (ms since epoch). */
  since: number;
  /** Maximum number of frames to return. Default: 100. */
  limit?: number;
  /** Filter by frame kind. */
  kind?: string;
  /** Filter by zone. */
  zone?: string;
};

export type ContextSyncResponse = {
  /** Frames matching the request criteria. */
  frames: ContextFrame[];
  /** The peer's current time (for clock drift awareness). */
  peerTimestamp: number;
  /** Total available frames (before limit was applied). */
  totalAvailable: number;
};

// ─── Sync Handler (server side — responds to sync requests) ──

/**
 * Handle an incoming context.sync request by querying the local world model.
 * Returns frames matching the request criteria.
 */
export function handleContextSyncRequest(
  worldModel: WorldModel,
  request: ContextSyncRequest,
): ContextSyncResponse {
  const limit = Math.min(request.limit ?? 100, 500); // Cap at 500 to prevent abuse
  const since = request.since;

  // Get all recent frames from the world model
  let frames = worldModel.getRecentFrames(500);

  // Filter by timestamp
  frames = frames.filter((f) => f.timestamp > since);

  // Filter by kind
  if (request.kind) {
    frames = frames.filter((f) => f.kind === request.kind);
  }

  // Filter by zone
  if (request.zone) {
    frames = frames.filter((f) => f.data.zone === request.zone);
  }

  const totalAvailable = frames.length;

  // Apply limit (take most recent)
  if (frames.length > limit) {
    frames = frames.slice(-limit);
  }

  return {
    frames,
    peerTimestamp: Date.now(),
    totalAvailable,
  };
}

// ─── Sync Client (requesting side — processes sync responses) ──

/**
 * Ingest sync response frames into the local world model.
 * Returns the count of newly ingested frames (not duplicates).
 */
export function ingestSyncResponse(
  worldModel: WorldModel,
  response: ContextSyncResponse,
): { ingested: number; duplicates: number } {
  let ingested = 0;
  let duplicates = 0;

  for (const frame of response.frames) {
    const isNew = worldModel.ingest(frame);
    if (isNew) {
      ingested++;
    } else {
      duplicates++;
    }
  }

  return { ingested, duplicates };
}

// ─── Sync Utilities ─────────────────────────────────────────

/**
 * Calculate when to request sync from (based on how long we've been offline).
 * Uses a conservative approach: request from slightly before the last known frame.
 */
export function calculateSyncSince(
  lastKnownFrameTimestamp: number | null,
  maxLookbackMs: number = 24 * 60 * 60 * 1000, // 24 hours default
): number {
  if (lastKnownFrameTimestamp === null) {
    // No known frames — request everything within lookback window
    return Date.now() - maxLookbackMs;
  }

  // Request from slightly before the last known frame (1 minute buffer for clock drift)
  return lastKnownFrameTimestamp - 60_000;
}
