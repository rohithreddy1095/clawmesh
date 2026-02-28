import type { MeshNodeRuntime } from "../../mesh/node-runtime.js";
import type { ContextFrame, ContextFrameKind } from "../../mesh/context-types.js";
import type { MeshForwardTrustMetadata } from "../../mesh/types.js";

/**
 * Tool definition compatible with the Anthropic Messages API tool_use format.
 */
export type MeshTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Create mesh-aware tools for the intelligence agent.
 * These tools let the LLM query world state and execute commands on mesh peers.
 */
export function createMeshTools(runtime: MeshNodeRuntime): MeshTool[] {
  return [
    {
      name: "query_world_model",
      description: `Query the mesh world model to see recent sensor observations,
events, and context from all connected mesh nodes. Use this to understand
current farm state before making decisions.`,
      input_schema: {
        type: "object" as const,
        properties: {
          kind: {
            type: "string",
            enum: ["observation", "event", "human_input", "inference", "all"],
            description: "Type of context frames to query (default: all)",
          },
          limit: {
            type: "number",
            description: "Max frames to return (default: 20)",
          },
          zone: {
            type: "string",
            description: "Filter by zone (e.g. 'zone-1')",
          },
        },
      },
      execute: async (params: Record<string, unknown>) => {
        const kind = (params.kind as string) ?? "all";
        const limit = (params.limit as number) ?? 20;
        const zone = params.zone as string | undefined;

        let frames: ContextFrame[];

        if (kind === "all") {
          frames = runtime.worldModel.getRecentFrames(limit);
        } else {
          // getByKind returns WorldModelEntry[] — extract lastFrame from each
          const entries = runtime.worldModel.getByKind(kind as ContextFrameKind);
          frames = entries.slice(-limit).map((e) => e.lastFrame);
        }

        // Filter by zone if specified
        if (zone) {
          frames = frames.filter((f) => f.data.zone === zone);
        }

        return formatFramesForLLM(frames);
      },
    },

    {
      name: "execute_mesh_command",
      description: `Execute a command on a mesh peer (e.g. start irrigation pump,
query sensor). The command will be forwarded to the appropriate field node
based on capability routing.`,
      input_schema: {
        type: "object" as const,
        properties: {
          targetRef: {
            type: "string",
            description:
              "Capability reference (e.g. 'actuator:mock:P1', 'sensor:moisture:zone-1')",
          },
          operation: {
            type: "string",
            description: "Operation name (e.g. 'start', 'stop', 'query', 'read')",
          },
          params: {
            type: "object",
            description: "Operation-specific parameters",
          },
          reasoning: {
            type: "string",
            description: "Why you are executing this command (for audit trail)",
          },
        },
        required: ["targetRef", "operation", "reasoning"],
      },
      execute: async (params: Record<string, unknown>) => {
        const targetRef = params.targetRef as string;
        const operation = params.operation as string;
        const opParams = params.params as Record<string, unknown> | undefined;
        const reasoning = params.reasoning as string;

        // Find a peer that has a matching capability.
        // Capabilities are advertised as prefixes (e.g. "actuator:mock"),
        // so we match against the targetRef prefix.
        const capPrefix = targetRef.split(":").slice(0, 2).join(":");
        let peerDeviceId: string | null = null;

        // First try exact match, then prefix match
        const exactPeers = runtime.capabilityRegistry.findPeersWithCapability(targetRef);
        if (exactPeers.length > 0) {
          peerDeviceId = exactPeers[0];
        } else {
          const prefixPeers = runtime.capabilityRegistry.findPeersWithCapability(capPrefix);
          if (prefixPeers.length > 0) {
            peerDeviceId = prefixPeers[0];
          }
        }

        if (!peerDeviceId) {
          return {
            success: false,
            error: `No mesh peer found with capability matching: ${targetRef} (searched: ${targetRef}, ${capPrefix})`,
          };
        }

        // Determine action type from targetRef
        const isActuation = targetRef.startsWith("actuator:");
        const actionType = isActuation ? "actuation" as const : "observation" as const;

        // Build honest trust metadata — LLM is the evidence source.
        // For actuation, require human verification; LLM alone cannot approve.
        const trust: MeshForwardTrustMetadata = isActuation
          ? {
              action_type: actionType,
              evidence_sources: ["llm"],
              evidence_trust_tier: "T0_planning_inference",
              minimum_trust_tier: "T2_operational_observation",
              verification_required: "human",
              verification_satisfied: false,
            }
          : {
              action_type: actionType,
              evidence_sources: ["llm"],
              evidence_trust_tier: "T0_planning_inference",
              minimum_trust_tier: "T0_planning_inference",
              verification_required: "none",
            };

        // Execute via mesh forwarding — trust policy is enforced at
        // both sender (sendMockActuation) and receiver (forward handler).
        const result = await runtime.sendMockActuation({
          peerDeviceId,
          targetRef,
          operation,
          operationParams: opParams,
          note: reasoning,
          trust,
        });

        // Broadcast the decision as an inference context frame
        runtime.contextPropagator.broadcastInference({
          data: {
            decision: `${targetRef}:${operation}`,
            targetRef,
            operation,
            reasoning,
            peerDeviceId: peerDeviceId.slice(0, 12) + "...",
            trustBlocked: !result.ok,
          },
          note: result.ok
            ? `Intelligence: ${reasoning}`
            : `Intelligence: actuation blocked by trust policy — ${result.error ?? "requires human approval"}`,
        });

        return result;
      },
    },

    {
      name: "list_mesh_capabilities",
      description: `List all connected mesh nodes and their advertised capabilities.
Use this to discover what sensors and actuators are available in the mesh.`,
      input_schema: {
        type: "object" as const,
        properties: {},
      },
      execute: async () => {
        const peers = runtime.listConnectedPeers();
        const allCaps = runtime.capabilityRegistry.listAll();

        return {
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
      },
    },
  ];
}

function formatFramesForLLM(frames: ContextFrame[]): string {
  if (frames.length === 0) {
    return "No context frames found matching query.";
  }

  return frames
    .map((f) => {
      const timestamp = new Date(f.timestamp).toISOString();
      const source = f.sourceDisplayName ?? f.sourceDeviceId.slice(0, 12) + "...";
      const lines = [`[${f.kind}] ${source} @ ${timestamp}`];
      lines.push(`Data: ${JSON.stringify(f.data, null, 2)}`);
      if (f.note) {
        lines.push(`Note: ${f.note}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}
