import type { ContextFrame, ContextFrameKind } from "./context-types.js";

export type WorldModelEntry = {
  lastFrame: ContextFrame;
  lastUpdated: number;
  updateCount: number;
};

export class WorldModel {
  private entries = new Map<string, WorldModelEntry>();
  private frameLog: ContextFrame[] = [];
  private seenFrameIds = new Set<string>();

  constructor(
    private opts: {
      maxHistory?: number;
      log: { info: (msg: string) => void };
    },
  ) {}

  /**
   * Ingest a context frame from a remote peer (or local propagator).
   * Returns true if the frame was new, false if it was a duplicate.
   */
  ingest(frame: ContextFrame): boolean {
    // Deduplicate by frameId
    if (this.seenFrameIds.has(frame.frameId)) {
      return false;
    }
    this.seenFrameIds.add(frame.frameId);

    const key = this.makeKey(frame);

    const existing = this.entries.get(key);
    const entry: WorldModelEntry = {
      lastFrame: frame,
      lastUpdated: Date.now(),
      updateCount: (existing?.updateCount ?? 0) + 1,
    };

    this.entries.set(key, entry);
    this.frameLog.push(frame);

    // Trim history
    const maxHistory = this.opts.maxHistory ?? 1000;
    if (this.frameLog.length > maxHistory) {
      this.frameLog = this.frameLog.slice(-maxHistory);
    }
    // Also trim seenFrameIds to avoid unbounded growth
    if (this.seenFrameIds.size > maxHistory * 2) {
      const idsToKeep = new Set(this.frameLog.map((f) => f.frameId));
      this.seenFrameIds = idsToKeep;
    }

    const source =
      frame.sourceDisplayName ?? `${frame.sourceDeviceId.slice(0, 12)}...`;
    this.opts.log.info(`[world-model] Ingested ${frame.kind} from ${source}`);

    return true;
  }

  /**
   * Query the world model for a specific key.
   */
  get(key: string): WorldModelEntry | undefined {
    return this.entries.get(key);
  }

  /**
   * Get all entries matching a kind.
   */
  getByKind(kind: ContextFrameKind): WorldModelEntry[] {
    return [...this.entries.values()].filter((e) => e.lastFrame.kind === kind);
  }

  /**
   * Get all entries.
   */
  getAll(): WorldModelEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Get all recent frames (most recent last).
   */
  getRecentFrames(limit: number = 100): ContextFrame[] {
    return this.frameLog.slice(-limit);
  }

  /**
   * Number of distinct entries in the world model.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Composite key for grouping frames: sourceDeviceId + kind + stable data identity.
   * For observations, uses zone+metric if available for a more stable key.
   */
  private makeKey(frame: ContextFrame): string {
    const data = frame.data;
    if (
      frame.kind === "observation" &&
      typeof data.zone === "string" &&
      typeof data.metric === "string"
    ) {
      return `${frame.sourceDeviceId}:${frame.kind}:${data.zone}:${data.metric}`;
    }
    const sortedData = Object.keys(data)
      .sort()
      .reduce(
        (acc, k) => {
          acc[k] = data[k];
          return acc;
        },
        {} as Record<string, unknown>,
      );
    return `${frame.sourceDeviceId}:${frame.kind}:${JSON.stringify(sortedData)}`;
  }
}
