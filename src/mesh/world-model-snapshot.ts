/**
 * WorldModelSnapshot — serialization/deserialization for WorldModel state.
 *
 * Enables:
 * - Save world model state to disk on shutdown
 * - Restore on startup for fast recovery
 * - Only keeps recent frames (configurable window)
 *
 * This avoids cold-start problems where the planner has no context
 * and must wait for new sensor data before making decisions.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ContextFrame } from "./context-types.js";

export interface WorldModelSnapshotData {
  version: 1;
  timestamp: number;
  nodeId: string;
  frames: ContextFrame[];
}

/**
 * Serialize recent world model frames to a snapshot.
 */
export function createSnapshot(
  frames: ContextFrame[],
  nodeId: string,
  maxFrames = 100,
): WorldModelSnapshotData {
  // Keep most recent frames, sorted by timestamp
  const sorted = [...frames].sort((a, b) => b.timestamp - a.timestamp).slice(0, maxFrames);
  return {
    version: 1,
    timestamp: Date.now(),
    nodeId,
    frames: sorted,
  };
}

/**
 * Save a snapshot to disk.
 */
export function saveSnapshot(path: string, snapshot: WorldModelSnapshotData): boolean {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(path, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load a snapshot from disk.
 * Returns null if file doesn't exist or is invalid.
 */
export function loadSnapshot(path: string): WorldModelSnapshotData | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw) as WorldModelSnapshotData;
    if (data.version !== 1 || !Array.isArray(data.frames)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Filter snapshot frames to only include those within a time window.
 */
export function filterSnapshotByAge(
  snapshot: WorldModelSnapshotData,
  maxAgeMs: number,
  now = Date.now(),
): ContextFrame[] {
  return snapshot.frames.filter(f => now - f.timestamp < maxAgeMs);
}

/**
 * Validate snapshot integrity — checks for required fields.
 */
export function isValidSnapshot(data: unknown): data is WorldModelSnapshotData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    d.version === 1 &&
    typeof d.timestamp === "number" &&
    typeof d.nodeId === "string" &&
    Array.isArray(d.frames)
  );
}
