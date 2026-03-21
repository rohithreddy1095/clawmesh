/**
 * RuntimeSetupHelpers — extracted wiring logic from MeshNodeRuntime constructor and lifecycle.
 *
 * Keeps the god object focused on orchestration by moving
 * setup/teardown helpers here.
 */

import type { MeshEventBus } from "./event-bus.js";
import type { SystemEventLog } from "./system-event-log.js";
import type { WorldModel } from "./world-model.js";
import type { ContextFrame } from "./context-types.js";
import type { CorrelationTracker } from "./correlation-tracker.js";
import { createSnapshot, saveSnapshot, loadSnapshot, filterSnapshotByAge } from "./world-model-snapshot.js";

/**
 * Wire the event bus to capture important events into the system event log.
 */
export function wireEventLog(eventBus: MeshEventBus, eventLog: SystemEventLog): void {
  eventBus.on("peer.connected", (data) => {
    const did = data.session?.deviceId?.slice(0, 12) ?? "?";
    eventLog.record("peer.connect", `Connected: ${did}…`, { deviceId: did });
  });
  eventBus.on("peer.disconnected", (data) => {
    const did = data.deviceId?.slice(0, 12) ?? "?";
    eventLog.record("peer.disconnect", `Disconnected: ${did}… (${data.reason ?? "unknown"})`, { deviceId: did });
  });
  eventBus.on("proposal.created", (data) => {
    const p = data.proposal;
    eventLog.record("proposal.created", `${p.approvalLevel} ${p.summary}`, { taskId: p.taskId });
  });
  eventBus.on("proposal.resolved", (data) => {
    const p = data.proposal;
    eventLog.record("proposal.resolved", `${p.status}: ${p.summary}`, { taskId: p.taskId, status: p.status });
  });
}

/**
 * Restore world model from a snapshot file.
 * Returns the number of frames restored.
 */
export function restoreWorldModelSnapshot(
  worldModel: WorldModel,
  snapshotPath: string,
  maxAgeMs = 3_600_000,
  log?: { info: (msg: string) => void },
): number {
  const snapshot = loadSnapshot(snapshotPath);
  if (!snapshot) return 0;

  const frames = filterSnapshotByAge(snapshot, maxAgeMs);
  for (const frame of frames) {
    worldModel.ingest(frame);
  }
  if (frames.length > 0) {
    log?.info(`mesh: restored ${frames.length} frames from snapshot (${snapshot.nodeId.slice(0, 12)}…)`);
  }
  return frames.length;
}

/**
 * Save world model snapshot to disk.
 * Returns true if saved successfully.
 */
export function saveWorldModelSnapshot(
  worldModel: WorldModel,
  nodeId: string,
  snapshotPath: string,
  maxFrames = 100,
  log?: { info: (msg: string) => void },
): boolean {
  const recentFrames = worldModel.getRecentFrames(maxFrames);
  if (recentFrames.length === 0) return false;

  const snap = createSnapshot(recentFrames, nodeId);
  if (saveSnapshot(snapshotPath, snap)) {
    log?.info(`mesh: saved ${recentFrames.length} frames to snapshot`);
    return true;
  }
  return false;
}

/**
 * Wire event bus events into the correlation tracker.
 * Traces causal chains from context frame ingestion through proposals.
 */
export function wireCorrelationTracker(
  eventBus: MeshEventBus,
  tracker: CorrelationTracker,
): void {
  eventBus.on("context.frame.ingested", (data) => {
    const frame = data.frame;
    if (frame?.kind === "observation" && frame.frameId) {
      tracker.start(frame.frameId, "sensor.ingest",
        `${frame.data.zone ?? "?"}:${frame.data.metric ?? "?"}=${frame.data.value ?? "?"}`,
        { sourceDeviceId: frame.sourceDeviceId },
      );
    }
  });

  eventBus.on("proposal.created", (data) => {
    const p = data.proposal;
    // Link proposal to the most recent trigger frame
    if (p.triggerFrameIds?.length > 0) {
      for (const fid of p.triggerFrameIds) {
        tracker.addStep(fid, "proposal.created",
          `${p.approvalLevel} ${p.summary} [${p.taskId.slice(0, 8)}]`,
          { taskId: p.taskId },
        );
      }
    }
  });

  eventBus.on("proposal.resolved", (data) => {
    const p = data.proposal;
    if (p.triggerFrameIds?.length > 0) {
      for (const fid of p.triggerFrameIds) {
        tracker.addStep(fid, `proposal.${p.status}`,
          `${p.summary} — by ${p.resolvedBy ?? "?"}`,
          { taskId: p.taskId, status: p.status },
        );
      }
    }
  });
}
