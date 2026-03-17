/**
 * Chat RPC handlers — manages UI subscription and proposal approval/rejection
 * over WebSocket RPC.
 *
 * Extracted from MeshNodeRuntime constructor to reduce god object size.
 */

import type { WebSocket } from "ws";
import type { UIBroadcaster } from "./ui-broadcaster.js";

type HandlerFn = (opts: {
  params: Record<string, unknown>;
  req?: unknown;
  respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void;
}) => void | Promise<void>;
type Handlers = Record<string, HandlerFn>;

export interface ChatHandlerDeps {
  uiBroadcaster: UIBroadcaster;
  /** Returns the planner session if available. */
  getPiSession: () => PiSessionLike | undefined;
  log: { info: (msg: string) => void };
}

/** Minimal interface for the PiSession dependency. */
export interface PiSessionLike {
  approveProposal(taskId: string): Promise<{ taskId: string; status: string } | null>;
  rejectProposal(taskId: string): { taskId: string; status: string } | null;
}

/**
 * Create RPC handlers for chat UI interaction.
 *
 * Handlers:
 *   - `chat.subscribe` — add a WebSocket as a UI subscriber
 *   - `chat.proposal.approve` — approve a pending proposal
 *   - `chat.proposal.reject` — reject a pending proposal
 */
export function createChatHandlers(deps: ChatHandlerDeps): Handlers {
  return {
    "chat.subscribe": ({ req, respond }) => {
      const socket = (req as any)?._socket as WebSocket | undefined;
      if (socket) {
        deps.uiBroadcaster.addSubscriber(socket);
        deps.log.info("mesh: UI client subscribed to chat");
      }
      respond(true, { subscribed: true });
    },

    "chat.proposal.approve": async ({ params, respond }) => {
      const taskId = params.taskId as string;
      if (!taskId) {
        respond(false, undefined, { code: "INVALID_PARAMS", message: "taskId required" });
        return;
      }
      const session = deps.getPiSession();
      if (!session) {
        respond(false, undefined, { code: "NO_PLANNER", message: "Pi planner not active" });
        return;
      }
      const proposal = await session.approveProposal(taskId);
      if (proposal) {
        respond(true, { proposal });
      } else {
        respond(false, undefined, { code: "NOT_FOUND", message: "Proposal not found or not awaiting approval" });
      }
    },

    "chat.proposal.reject": ({ params, respond }) => {
      const taskId = params.taskId as string;
      if (!taskId) {
        respond(false, undefined, { code: "INVALID_PARAMS", message: "taskId required" });
        return;
      }
      const session = deps.getPiSession();
      if (!session) {
        respond(false, undefined, { code: "NO_PLANNER", message: "Pi planner not active" });
        return;
      }
      const proposal = session.rejectProposal(taskId);
      if (proposal) {
        respond(true, { proposal });
      } else {
        respond(false, undefined, { code: "NOT_FOUND", message: "Proposal not found or not awaiting approval" });
      }
    },
  };
}
