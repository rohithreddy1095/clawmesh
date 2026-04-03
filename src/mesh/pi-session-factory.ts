/**
 * PiSession factory — extracted from node-runtime to reduce god object.
 *
 * Creates and starts a PiSession with retry logic, wired to the
 * runtime's event bus, peer registry, and UI broadcaster.
 */

import { PiSession } from "../agents/pi-session.js";
import type { MeshNodeRuntime } from "./node-runtime.js";
import type { FarmContext, ThresholdRule, TaskProposal } from "../agents/types.js";

export type PiSessionFactoryOpts = {
  runtime: MeshNodeRuntime;
  modelSpec?: string;
  thinkingLevel?: string;
  farmContext?: FarmContext;
  thresholds?: ThresholdRule[];
  proactiveIntervalMs?: number;
  onProposalCreated?: (proposal: TaskProposal) => void;
  onProposalResolved?: (proposal: TaskProposal) => void;
  log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
};

/**
 * Create a PiSession wired to the runtime, then start it with retry.
 */
export function createAndStartPiSession(opts: PiSessionFactoryOpts): PiSession {
  const rt = opts.runtime;

  const session = new PiSession({
    runtime: rt,
    modelSpec: opts.modelSpec ?? "anthropic/claude-sonnet-4-5-20250929",
    thinkingLevel: (opts.thinkingLevel ?? "off") as any,
    farmContext: opts.farmContext,
    thresholds: opts.thresholds,
    proactiveIntervalMs: opts.proactiveIntervalMs ?? 60_000,
    onProposalCreated: (proposal) => {
      rt.peerRegistry.broadcastEvent("planner.proposal", proposal);
      rt.eventBus.emit("proposal.created", { proposal });
      opts.onProposalCreated?.(proposal);
    },
    onProposalResolved: (proposal) => {
      rt.peerRegistry.broadcastEvent("planner.proposal.resolved", proposal);
      rt.eventBus.emit("proposal.resolved", { proposal });
      opts.onProposalResolved?.(proposal);
    },
    onModeChange: (mode, reason) => {
      opts.log.info(`[pi-mode] ${mode.toUpperCase()} — ${reason}`);
    },
    log: opts.log,
  });

  // Start with retry (exponential backoff)
  startWithRetry(session, opts.log);

  return session;
}

function startWithRetry(
  session: PiSession,
  log: { info: (msg: string) => void; error: (msg: string) => void },
  attempt = 1,
  maxAttempts = 5,
): void {
  session.start().then(() => {
    log.info("mesh: pi-session started (createAgentSession SDK)");
  }).catch((err) => {
    log.error(`mesh: pi-session failed to start (attempt ${attempt}/${maxAttempts}): ${err}`);
    if (attempt < maxAttempts) {
      const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 30_000);
      log.info(`mesh: pi-session will retry in ${Math.round(delayMs / 1000)}s...`);
      setTimeout(() => startWithRetry(session, log, attempt + 1, maxAttempts), delayMs).unref();
    } else {
      log.error("mesh: pi-session start failed after all retries. Mesh continues without planner.");
    }
  });
}
