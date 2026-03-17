/**
 * ClawMesh Pi Extension — registers mesh tools, slash commands, and lifecycle
 * hooks as a first-class Pi extension factory.
 *
 * Tools:
 *   query_world_model, list_mesh_capabilities, execute_mesh_command,
 *   propose_task, list_proposals
 *
 * Commands:
 *   /mesh-status, /proposals, /approve <id>, /reject <id>
 *
 * Hooks:
 *   before_agent_start — injects fresh mesh snapshot into system prompt
 *   tool_call — blocks execute_mesh_command on actuator refs
 */

import type { ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { Type } from "@mariozechner/pi-ai";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { randomUUID } from "node:crypto";

import type { MeshNodeRuntime } from "../../mesh/node-runtime.js";
import type { ContextFrame, ContextFrameKind } from "../../mesh/context-types.js";
import type { MeshForwardTrustMetadata } from "../../mesh/types.js";
import type { ApprovalLevel, TaskProposal, ThresholdRule } from "../types.js";
import {
  formatFrames,
  findProposalByPrefix as _findProposalByPrefix,
  findPeerForCapability as _findPeerForCapability,
  summarizeProposals,
  countPending,
} from "./mesh-extension-helpers.js";

// ─── Shared proposal state (singleton per extension instance) ──────

export interface MeshExtensionState {
  proposals: Map<string, TaskProposal>;
  thresholds: ThresholdRule[];
  thresholdLastFired: Map<string, number>;
  maxPendingProposals: number;
  onProposalCreated?: (proposal: TaskProposal) => void;
  onProposalResolved?: (proposal: TaskProposal) => void;
}

// ─── Factory ───────────────────────────────────────────────────────

export function createClawMeshExtension(
  runtime: MeshNodeRuntime,
  state: MeshExtensionState,
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const log = {
      info: (msg: string) => console.log(msg),
      warn: (msg: string) => console.warn(msg),
      error: (msg: string) => console.error(msg),
    };

    // ─── Tools ──────────────────────────────────────────

    // 1. query_world_model
    pi.registerTool({
      name: "query_world_model",
      label: "Query World Model",
      description: `Query the mesh world model to see recent sensor observations,
events, and context from all connected mesh nodes. Use this to understand
current farm state before making decisions.`,
      promptSnippet: "Query sensor data, observations, events from all mesh nodes.",
      promptGuidelines: [
        "Always call query_world_model before proposing actions — never fabricate sensor data.",
        "Filter by kind and zone for efficient queries.",
      ],
      parameters: Type.Object({
        kind: Type.Optional(
          Type.Union([
            Type.Literal("observation"),
            Type.Literal("event"),
            Type.Literal("human_input"),
            Type.Literal("inference"),
            Type.Literal("all"),
          ], { description: "Type of context frames to query (default: all)" }),
        ),
        limit: Type.Optional(Type.Number({ description: "Max frames to return (default: 20)" })),
        zone: Type.Optional(Type.String({ description: "Filter by zone (e.g. 'zone-1')" })),
      }),
      async execute(_toolCallId, args) {
        const kind = args.kind ?? "all";
        const limit = args.limit ?? 20;

        let frames: ContextFrame[];
        if (kind === "all") {
          frames = runtime.worldModel.getRecentFrames(limit);
        } else {
          const entries = runtime.worldModel.getByKind(kind as ContextFrameKind);
          frames = entries.slice(-limit).map((e) => e.lastFrame);
        }

        if (args.zone) {
          frames = frames.filter((f) => f.data.zone === args.zone);
        }

        const text = formatFrames(frames);
        return { content: [{ type: "text", text }], details: { frameCount: frames.length } };
      },
    });

    // 2. list_mesh_capabilities
    pi.registerTool({
      name: "list_mesh_capabilities",
      label: "List Mesh Capabilities",
      description: "List all connected mesh nodes and their advertised capabilities.",
      promptSnippet: "Discover connected nodes, sensors, and actuators.",
      parameters: Type.Object({}),
      async execute() {
        const peers = runtime.listConnectedPeers();
        const allCaps = runtime.capabilityRegistry.listAll();

        const result = {
          connectedPeers: peers.length,
          peers: peers.map((p) => ({
            deviceId: p.deviceId.slice(0, 12) + "...",
            displayName: p.displayName,
            capabilities: p.capabilities,
          })),
          capabilityIndex: allCaps.map((c) => ({
            deviceId: c.deviceId.slice(0, 12) + "...",
            capabilities: c.capabilities,
          })),
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      },
    });

    // 3. execute_mesh_command
    pi.registerTool({
      name: "execute_mesh_command",
      label: "Execute Mesh Command",
      description: `Execute a safe read-only command on a mesh peer (L0 only).
For actuation (pumps, valves), use propose_task instead.`,
      promptSnippet: "Execute read-only mesh commands. Actuation → use propose_task.",
      promptGuidelines: [
        "NEVER use execute_mesh_command for actuators — always use propose_task.",
      ],
      parameters: Type.Object({
        targetRef: Type.String({ description: "Capability reference (e.g. 'sensor:moisture:zone-1')" }),
        operation: Type.String({ description: "Operation name (e.g. 'read', 'query')" }),
        params: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Operation parameters" })),
        reasoning: Type.String({ description: "Why you are executing this command" }),
      }),
      async execute(_toolCallId, args): Promise<AgentToolResult<any>> {
        const { targetRef, operation, reasoning } = args;

        // Resolve peer
        const peerDeviceId = findPeerForCapability(targetRef);
        if (!peerDeviceId) {
          return {
            content: [{ type: "text", text: `No mesh peer with capability: ${targetRef}` }],
            details: { ok: false },
          };
        }

        // Block actuation
        if (targetRef.startsWith("actuator:")) {
          return {
            content: [{ type: "text", text: "Actuation commands must use propose_task, not execute_mesh_command." }],
            details: { ok: false, blocked: "use_propose_task" },
          };
        }

        const trust: MeshForwardTrustMetadata = {
          action_type: "observation",
          evidence_sources: ["llm"],
          evidence_trust_tier: "T0_planning_inference",
          minimum_trust_tier: "T0_planning_inference",
          verification_required: "none",
        };

        const result = await runtime.sendMockActuation({
          peerDeviceId,
          targetRef,
          operation,
          operationParams: args.params,
          note: reasoning,
          trust,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      },
    });

    // 4. propose_task
    pi.registerTool({
      name: "propose_task",
      label: "Propose Task",
      description: `Create a task proposal for farm operations that need human approval.
This is the ONLY way to trigger physical actuation (pumps, valves, relays).`,
      promptSnippet: "Create actuation proposals for the human approval queue.",
      promptGuidelines: [
        "LLM alone NEVER triggers physical actuation — use propose_task with L2+ approval.",
        "Always cite specific sensor values in your reasoning.",
      ],
      parameters: Type.Object({
        summary: Type.String({ description: "Short description of the proposed action" }),
        reasoning: Type.String({ description: "Why this action is needed — cite specific sensor data" }),
        targetRef: Type.String({ description: "Capability reference (e.g. 'actuator:pump:P1')" }),
        operation: Type.String({ description: "Operation name (e.g. 'start', 'open')" }),
        operationParams: Type.Optional(
          Type.Record(Type.String(), Type.Unknown(), { description: "Operation parameters" }),
        ),
        approvalLevel: Type.Union([
          Type.Literal("L1"),
          Type.Literal("L2"),
          Type.Literal("L3"),
        ], { description: "Required approval level" }),
      }),
      async execute(_toolCallId, args): Promise<AgentToolResult<any>> {
        const { summary, reasoning, targetRef, operation, operationParams } = args;
        const approvalLevel = (args.approvalLevel as ApprovalLevel) ?? "L2";

        const peerDeviceId = findPeerForCapability(targetRef);
        if (!peerDeviceId) {
          return {
            content: [{ type: "text", text: `No mesh peer with capability: ${targetRef}` }],
            details: { ok: false },
          };
        }

        const proposal: TaskProposal = {
          taskId: randomUUID(),
          summary,
          reasoning,
          targetRef,
          operation,
          operationParams,
          peerDeviceId,
          approvalLevel,
          status: approvalLevel === "L1" ? "approved" : "awaiting_approval",
          createdBy: "intelligence",
          triggerFrameIds: [],
          createdAt: Date.now(),
        };

        state.proposals.set(proposal.taskId, proposal);

        runtime.contextPropagator.broadcastInference({
          data: {
            proposalId: proposal.taskId,
            summary, targetRef, operation, approvalLevel,
            status: proposal.status,
          },
          note: `Pi planner proposed: ${summary} (${approvalLevel})`,
        });

        state.onProposalCreated?.(proposal);
        log.info(
          `[mesh-ext] proposed [${proposal.taskId.slice(0, 8)}] ${summary} → ${targetRef}:${operation} (${approvalLevel})`,
        );

        // Auto-execute L1
        if (proposal.status === "approved") {
          await executeProposal(proposal);
        }

        return {
          content: [{
            type: "text",
            text: proposal.status === "awaiting_approval"
              ? `Proposal created (${approvalLevel}). Awaiting human approval. Task ID: ${proposal.taskId.slice(0, 8)}`
              : `L1 auto-approved and executing. Task ID: ${proposal.taskId.slice(0, 8)}`,
          }],
          details: { ok: true, taskId: proposal.taskId, status: proposal.status },
        };
      },
    });

    // 5. list_proposals
    pi.registerTool({
      name: "list_proposals",
      label: "List Proposals",
      description: "List all task proposals and their status.",
      promptSnippet: "Check the status of task proposals in the approval queue.",
      parameters: Type.Object({
        status: Type.Optional(
          Type.Union([
            Type.Literal("proposed"),
            Type.Literal("awaiting_approval"),
            Type.Literal("approved"),
            Type.Literal("executing"),
            Type.Literal("completed"),
            Type.Literal("rejected"),
            Type.Literal("failed"),
            Type.Literal("all"),
          ], { description: "Filter by status (default: all)" }),
        ),
      }),
      async execute(_toolCallId, args) {
        const statusFilter = args.status;
        const proposals = statusFilter && statusFilter !== "all"
          ? [...state.proposals.values()].filter((p) => p.status === statusFilter)
          : [...state.proposals.values()];

        if (proposals.length === 0) {
          return { content: [{ type: "text", text: "No proposals found." }], details: [] };
        }

        const summary = summarizeProposals(proposals);

        return {
          content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
          details: summary,
        };
      },
    });

    // ─── Slash commands ─────────────────────────────────

    pi.registerCommand("mesh-status", {
      description: "Show mesh connectivity and world model summary",
      handler: async (_args, ctx) => {
        const peers = runtime.listConnectedPeers();
        const frameCount = runtime.worldModel.getRecentFrames(100).length;
        const pending = countPending(state.proposals);

        const lines = [
          `Mesh Status:`,
          `  Connected peers: ${peers.length}`,
          ...peers.map((p) => `    ${p.displayName ?? p.deviceId.slice(0, 12)} — ${p.capabilities.join(", ")}`),
          `  World model frames: ${frameCount}`,
          `  Pending proposals: ${pending}`,
        ];
        ctx.ui.notify(lines.join("\n"), "info");
      },
    });

    pi.registerCommand("proposals", {
      description: "List all task proposals",
      handler: async (_args, ctx) => {
        const proposals = [...state.proposals.values()];
        if (proposals.length === 0) {
          ctx.ui.notify("No proposals.", "info");
          return;
        }
        const lines = proposals.map((p) =>
          `[${p.taskId.slice(0, 8)}] ${p.status.toUpperCase()} ${p.approvalLevel} — ${p.summary}`,
        );
        ctx.ui.notify(lines.join("\n"), "info");
      },
    });

    pi.registerCommand("approve", {
      description: "Approve a task proposal: /approve <task-id-prefix>",
      handler: async (args, ctx) => {
        const prefix = args.trim();
        if (!prefix) {
          ctx.ui.notify("Usage: /approve <task-id-prefix>", "warning");
          return;
        }
        const proposal = findProposalByPrefix(prefix);
        if (!proposal) {
          ctx.ui.notify(`No proposal matching "${prefix}"`, "warning");
          return;
        }
        if (proposal.status !== "awaiting_approval") {
          ctx.ui.notify(`Proposal ${proposal.taskId.slice(0, 8)} is ${proposal.status}, not awaiting approval`, "warning");
          return;
        }
        proposal.status = "approved";
        proposal.resolvedBy = "operator";
        await executeProposal(proposal);
        ctx.ui.notify(`Approved and executing: ${proposal.summary}`, "info");
      },
    });

    pi.registerCommand("reject", {
      description: "Reject a task proposal: /reject <task-id-prefix>",
      handler: async (args, ctx) => {
        const prefix = args.trim();
        if (!prefix) {
          ctx.ui.notify("Usage: /reject <task-id-prefix>", "warning");
          return;
        }
        const proposal = findProposalByPrefix(prefix);
        if (!proposal) {
          ctx.ui.notify(`No proposal matching "${prefix}"`, "warning");
          return;
        }
        if (proposal.status !== "awaiting_approval") {
          ctx.ui.notify(`Proposal ${proposal.taskId.slice(0, 8)} is ${proposal.status}, not awaiting approval`, "warning");
          return;
        }
        proposal.status = "rejected";
        proposal.resolvedAt = Date.now();
        proposal.resolvedBy = "operator";
        state.onProposalResolved?.(proposal);
        ctx.ui.notify(`Rejected: ${proposal.summary}`, "info");
      },
    });

    // ─── Hooks ──────────────────────────────────────────

    // Inject fresh mesh state snapshot each agent turn
    pi.on("before_agent_start", (event) => {
      const peers = runtime.listConnectedPeers();
      const pending = [...state.proposals.values()].filter(
        (p) => p.status === "proposed" || p.status === "awaiting_approval",
      );

      // Use the intelligent world model summarize() for compact, zone-grouped context
      const worldSummary = runtime.worldModel.summarize(10);

      // Also include the top 3 most relevant frames for detailed LLM reasoning
      const relevantFrames = runtime.worldModel.getRelevantFrames(3);
      const relevantSection = relevantFrames.length > 0
        ? `Most relevant frames:\n${relevantFrames.map((f) => `  [${f.kind}] ${f.data?.metric ?? f.data?.event ?? "—"}: ${JSON.stringify(f.data).slice(0, 120)}`).join("\n")}`
        : "";

      const snapshot = [
        `\n\n# Live Mesh Snapshot (${new Date().toISOString()})`,
        `Connected peers: ${peers.length}`,
        ...peers.map((p) => `  ${p.displayName ?? p.deviceId.slice(0, 12)} [${p.capabilities.join(",")}]`),
        worldSummary,
        relevantSection,
        pending.length > 0
          ? `Pending proposals: ${pending.length}\n${pending.map((p) => `  [${p.taskId.slice(0, 8)}] ${p.approvalLevel} ${p.summary}`).join("\n")}`
          : "Pending proposals: 0",
      ].filter(Boolean).join("\n");

      return {
        systemPrompt: event.systemPrompt + snapshot,
      };
    });

    // Block actuation via execute_mesh_command — force propose_task
    pi.on("tool_call", (event) => {
      if (event.toolName === "execute_mesh_command") {
        const input = event.input as Record<string, unknown>;
        const targetRef = String(input.targetRef ?? "");
        if (targetRef.startsWith("actuator:")) {
          return {
            block: true,
            reason: "Actuation must use propose_task for human approval. execute_mesh_command is read-only.",
          };
        }
      }
    });

    // ─── Helpers (closure-scoped) ───────────────────────

    function findPeerForCapability(targetRef: string): string | null {
      return _findPeerForCapability(
        (ref) => runtime.capabilityRegistry.findPeersWithCapability(ref),
        targetRef,
      );
    }

    function findProposalByPrefix(prefix: string): TaskProposal | undefined {
      return _findProposalByPrefix(state.proposals, prefix);
    }

    async function executeProposal(proposal: TaskProposal): Promise<void> {
      proposal.status = "executing";

      try {
        const result = await runtime.sendMockActuation({
          peerDeviceId: proposal.peerDeviceId,
          targetRef: proposal.targetRef,
          operation: proposal.operation,
          operationParams: proposal.operationParams,
          note: `[mesh-ext] ${proposal.summary} — approved by ${proposal.resolvedBy ?? "auto"}`,
          trust: {
            action_type: "actuation",
            evidence_sources: ["sensor", "human"],
            evidence_trust_tier: "T3_verified_action_evidence",
            minimum_trust_tier: "T2_operational_observation",
            verification_required: "human",
            verification_satisfied: true,
            approved_by: [proposal.resolvedBy ?? "operator"],
          },
        });

        proposal.status = result.ok ? "completed" : "failed";
        proposal.result = result;
        proposal.resolvedAt = Date.now();

        runtime.contextPropagator.broadcast({
          kind: "event",
          data: {
            proposalId: proposal.taskId,
            summary: proposal.summary,
            targetRef: proposal.targetRef,
            operation: proposal.operation,
            result: result.ok ? "success" : "failed",
          },
          trust: {
            evidence_sources: ["sensor", "human"],
            evidence_trust_tier: "T3_verified_action_evidence",
          },
          note: result.ok
            ? `Executed: ${proposal.summary}`
            : `Failed: ${proposal.summary}`,
        });

      } catch (err) {
        proposal.status = "failed";
        proposal.result = { ok: false, error: String(err) };
        proposal.resolvedAt = Date.now();
      }

      state.onProposalResolved?.(proposal);
    }

    // formatFrames is now imported from mesh-extension-helpers.ts
  };
}
