import type { ContextFrame } from "../context-types.js";
import type { WorldModel } from "../world-model.js";

type HandlerFn = (opts: {
  params: Record<string, unknown>;
  respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void;
}) => void | Promise<void>;
type GatewayRequestHandlers = Record<string, HandlerFn>;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export type MeshWorldQueryResult = {
  count: number;
  entries: number;
  frames: ContextFrame[];
  bySourceDeviceId: Record<string, number>;
  byKind: Record<string, number>;
  byTrustTier: Record<string, number>;
  peerTimestamp: number;
};

export function createWorldQueryHandlers(deps: {
  worldModel: WorldModel;
}): GatewayRequestHandlers {
  return {
    "mesh.world.query": ({ params, respond }) => {
      const limit = parseLimit(params.limit);
      const kind = typeof params.kind === "string" ? params.kind : undefined;
      const sourceDeviceId = typeof params.sourceDeviceId === "string" ? params.sourceDeviceId : undefined;

      let frames = deps.worldModel.getRecentFrames(10_000);
      if (kind) {
        frames = frames.filter((frame) => frame.kind === kind);
      }
      if (sourceDeviceId) {
        frames = frames.filter((frame) => frame.sourceDeviceId === sourceDeviceId);
      }
      frames = frames.slice(-limit);

      respond(true, {
        count: frames.length,
        entries: deps.worldModel.size,
        frames,
        bySourceDeviceId: countBy(frames, (frame) => frame.sourceDeviceId),
        byKind: countBy(frames, (frame) => frame.kind),
        byTrustTier: countBy(frames, (frame) => frame.trust.evidence_trust_tier),
        peerTimestamp: Date.now(),
      } satisfies MeshWorldQueryResult);
    },
  };
}

function parseLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(0, Math.min(MAX_LIMIT, Math.floor(value)));
}

function countBy(frames: ContextFrame[], keyFn: (frame: ContextFrame) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const frame of frames) {
    const key = keyFn(frame);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
