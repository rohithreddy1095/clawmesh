/**
 * PiSession — wraps createAgentSession() from @mariozechner/pi-coding-agent,
 * wiring the ClawMesh mesh extension, farm system prompt, and planner cycle logic.
 *
 * This replaces the manual `new Agent()` in the old PiPlanner with a full
 * AgentSession that gets compaction, extension lifecycle, prompt templates,
 * skills, and multi-provider support for free.
 */

import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import { getModel, type Model } from "@mariozechner/pi-ai";
import type { AgentEvent, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { MeshNodeRuntime } from "../mesh/node-runtime.js";
import type { ContextFrame } from "../mesh/context-types.js";
import type { FarmContext, TaskProposal, ThresholdRule } from "./types.js";
import {
  createClawMeshExtension,
  type MeshExtensionState,
} from "./extensions/clawmesh-mesh-extension.js";

// ─── Types ──────────────────────────────────────────────────────────

export type PiSessionOptions = {
  runtime: MeshNodeRuntime;
  /** Provider + model ID (e.g. "anthropic/claude-sonnet-4-5-20250929"). */
  modelSpec?: string;
  /** Thinking level. */
  thinkingLevel?: ThinkingLevel;
  /** Farm context for the system prompt. */
  farmContext?: FarmContext;
  /** Threshold rules. */
  thresholds?: ThresholdRule[];
  /** Proactive check interval (ms). 0 = disabled. */
  proactiveIntervalMs?: number;
  /** Max pending proposals. */
  maxPendingProposals?: number;
  /** Callbacks. */
  onProposalCreated?: (proposal: TaskProposal) => void;
  onProposalResolved?: (proposal: TaskProposal) => void;
  onAgentEvent?: (event: AgentEvent) => void;
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};

// ─── PiSession ──────────────────────────────────────────────────────

export class PiSession {
  private readonly runtime: MeshNodeRuntime;
  private readonly log: NonNullable<PiSessionOptions["log"]>;
  private readonly farmContext?: FarmContext;
  private readonly extensionState: MeshExtensionState;

  private session!: AgentSession;
  private pendingTriggers: Array<{ reason: string; frames: ContextFrame[] }> = [];
  private thresholdLastFired = new Map<string, number>();
  private proactiveTimer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;
  private initialized = false;
  private model: Model<any>;
  private thinkingLevel: ThinkingLevel;
  private opts: PiSessionOptions;

  constructor(opts: PiSessionOptions) {
    this.opts = opts;
    this.runtime = opts.runtime;
    this.log = opts.log ?? {
      info: (msg) => console.log(msg),
      warn: (msg) => console.warn(msg),
      error: (msg) => console.error(msg),
    };
    this.farmContext = opts.farmContext;
    this.thinkingLevel = opts.thinkingLevel ?? "off";
    this.model = this.resolveModel(opts.modelSpec ?? "anthropic/claude-sonnet-4-5-20250929");

    // Shared state between extension and this session controller
    this.extensionState = {
      proposals: new Map(),
      thresholds: opts.thresholds ?? [],
      thresholdLastFired: this.thresholdLastFired,
      maxPendingProposals: opts.maxPendingProposals ?? 10,
      onProposalCreated: (proposal) => {
        this.runtime.peerRegistry.broadcastEvent("planner.proposal", proposal);
        opts.onProposalCreated?.(proposal);
      },
      onProposalResolved: (proposal) => {
        this.runtime.peerRegistry.broadcastEvent("planner.proposal.resolved", proposal);
        opts.onProposalResolved?.(proposal);
      },
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────

  async start(): Promise<void> {
    this.stopped = false;

    // Build the Pi session
    const systemPrompt = this.buildSystemPrompt();

    const resourceLoader = new DefaultResourceLoader({
      cwd: process.cwd(),
      systemPromptOverride: () => systemPrompt,
      appendSystemPromptOverride: () => [],
      extensionFactories: [
        createClawMeshExtension(this.runtime, this.extensionState),
      ],
      // ClawMesh manages its own skills/prompts from the .pi/ directory
      noSkills: false,
      noPromptTemplates: false,
      noThemes: true,
      noExtensions: true, // we only use the inline extension factory above
    });
    await resourceLoader.reload();

    const extensions = resourceLoader.getExtensions();
    const extToolNames = extensions.extensions.flatMap(e => [...e.tools.keys()]);
    this.log.info(`pi-session: extensions loaded: ${extensions.extensions.length}, tools: [${extToolNames.join(", ")}], errors: ${extensions.errors.length}`);
    if (extensions.errors.length > 0) {
      for (const err of extensions.errors) {
        this.log.error(`pi-session: extension error (${err.path}): ${err.error}`);
      }
    }

    const { session } = await createAgentSession({
      resourceLoader,
      sessionManager: SessionManager.inMemory(),
      model: this.model,
      thinkingLevel: this.thinkingLevel,
      tools: [], // no built-in coding tools — our extension provides all tools
    });

    this.session = session;
    this.initialized = true;

    // Debug: verify which tools actually reached the agent
    const activeTools = this.session.getActiveToolNames();
    const allTools = this.session.getAllTools().map(t => t.name);
    this.log.info(`pi-session: active tools (${activeTools.length}): [${activeTools.join(", ")}]`);
    this.log.info(`pi-session: all registered tools (${allTools.length}): [${allTools.join(", ")}]`);

    // Subscribe to agent events for logging/broadcasting
    this.session.subscribe((event) => {
      this.handleSessionEvent(event);
      this.opts.onAgentEvent?.(event as AgentEvent);
    });

    // Wire world model ingest hook
    this.runtime.worldModel.onIngest = (frame) => {
      this.handleIncomingFrame(frame);
    };

    // Start proactive timer
    const intervalMs = this.opts.proactiveIntervalMs ?? 60_000;
    if (intervalMs > 0) {
      this.proactiveTimer = setInterval(() => {
        this.triggerProactiveCheck();
      }, intervalMs);
    }

    this.log.info(
      `pi-session: started — model=${this.model.provider}/${this.model.id}, thinking=${this.thinkingLevel}`,
    );
  }

  stop(): void {
    this.stopped = true;
    if (this.proactiveTimer) {
      clearInterval(this.proactiveTimer);
      this.proactiveTimer = undefined;
    }
    this.runtime.worldModel.onIngest = undefined;
    if (this.initialized) {
      void this.session.abort();
    }
    this.log.info("pi-session: stopped");
  }

  // ─── External triggers ─────────────────────────────────

  handleOperatorIntent(text: string): void {
    this.pendingTriggers.push({
      reason: `operator_intent: "${text}"`,
      frames: [],
    });
    void this.runCycle();
  }

  async approveProposal(taskId: string, approvedBy = "operator"): Promise<TaskProposal | null> {
    const proposal = this.extensionState.proposals.get(taskId);
    if (!proposal || proposal.status !== "awaiting_approval") return null;

    proposal.status = "approved";
    proposal.resolvedBy = approvedBy;

    // Tell the agent about the approval
    if (this.initialized && !this.session.isStreaming) {
      await this.session.prompt(
        `Proposal [${taskId.slice(0, 8)}] "${proposal.summary}" has been APPROVED by ${approvedBy}. Execute it now.`,
      );
    }

    return proposal;
  }

  rejectProposal(taskId: string, rejectedBy = "operator"): TaskProposal | null {
    const proposal = this.extensionState.proposals.get(taskId);
    if (!proposal || proposal.status !== "awaiting_approval") return null;

    proposal.status = "rejected";
    proposal.resolvedAt = Date.now();
    proposal.resolvedBy = rejectedBy;
    this.extensionState.onProposalResolved?.(proposal);
    return proposal;
  }

  getProposals(filter?: { status?: TaskProposal["status"] }): TaskProposal[] {
    const all = [...this.extensionState.proposals.values()];
    return filter?.status ? all.filter((p) => p.status === filter.status) : all;
  }

  getProposal(taskId: string): TaskProposal | undefined {
    return this.extensionState.proposals.get(taskId);
  }

  getSession(): AgentSession {
    return this.session;
  }

  // ─── Context handlers ──────────────────────────────────

  private handleIncomingFrame(frame: ContextFrame): void {
    this.log.info(`pi-session: incoming ${frame.kind} — metric=${frame.data.metric}, value=${frame.data.value}, thresholds=${this.extensionState.thresholds.length}`);
    for (const rule of this.extensionState.thresholds) {
      if (this.checkThresholdRule(rule, frame)) {
        this.log.info(`pi-session: THRESHOLD BREACH — ${rule.ruleId}: value=${frame.data.value}`);
        this.pendingTriggers.push({
          reason: `threshold_breach: ${rule.ruleId} — ${rule.promptHint}`,
          frames: [frame],
        });
      }
    }
    if (this.pendingTriggers.length > 0) {
      void this.runCycle();
    }
  }

  private checkThresholdRule(rule: ThresholdRule, frame: ContextFrame): boolean {
    if (frame.kind !== "observation") return false;
    const data = frame.data;
    if (typeof data.metric !== "string" || data.metric !== rule.metric) return false;
    if (rule.zone && data.zone !== rule.zone) return false;
    const value = typeof data.value === "number" ? data.value : null;
    if (value === null) return false;

    let breached = false;
    if (rule.belowThreshold !== undefined && value < rule.belowThreshold) breached = true;
    if (rule.aboveThreshold !== undefined && value > rule.aboveThreshold) breached = true;
    if (!breached) return false;

    const cooldownMs = rule.cooldownMs ?? 300_000;
    const lastFired = this.thresholdLastFired.get(rule.ruleId) ?? 0;
    if (Date.now() - lastFired < cooldownMs) return false;
    this.thresholdLastFired.set(rule.ruleId, Date.now());
    return true;
  }

  private triggerProactiveCheck(): void {
    const recentFrames = this.runtime.worldModel.getRecentFrames(5);
    if (recentFrames.length === 0) return;
    this.pendingTriggers.push({
      reason: "proactive_check: periodic farm state review",
      frames: recentFrames,
    });
    void this.runCycle();
  }

  // ─── Planner cycle ─────────────────────────────────────

  private async runCycle(): Promise<void> {
    if (this.running || this.stopped || !this.initialized) {
      this.log.info(`pi-session: runCycle skipped — running=${this.running}, stopped=${this.stopped}, initialized=${this.initialized}`);
      return;
    }

    const pendingCount = [...this.extensionState.proposals.values()].filter(
      (p) => p.status === "proposed" || p.status === "awaiting_approval",
    ).length;
    if (pendingCount >= this.extensionState.maxPendingProposals) {
      this.log.warn(`pi-session: ${pendingCount} pending proposals — pausing`);
      return;
    }

    this.running = true;

    try {
      const triggers = [...this.pendingTriggers];
      this.pendingTriggers = [];
      if (triggers.length === 0) return;

      const triggerSummary = triggers.map((t) => `- ${t.reason}`).join("\n");
      const prompt = `[PLANNER CYCLE ${new Date().toISOString()}]
Triggers:
${triggerSummary}

Review the current mesh state using your tools, then either:
1. Take no action if everything is within acceptable parameters
2. Use propose_task to create proposals for actions that need human approval (L2/L3 actuation)
3. For safe read-only operations (L0), execute them directly

Always explain your reasoning. Never fabricate sensor data.`;

      // Use the AgentSession's prompt — gets compaction, extension hooks, etc.
      const toolsNow = this.session.getActiveToolNames();
      const sysPrompt = this.session.state.systemPrompt;
      const msgCount = this.session.state.messages.length;
      this.log.info(`pi-session: runCycle — sending prompt to LLM (isStreaming=${this.session.isStreaming}, tools=${toolsNow.length}:[${toolsNow.join(",")}], sysPromptLen=${sysPrompt?.length ?? 0}, messages=${msgCount})`);
      try {
        if (this.session.isStreaming) {
          // If currently streaming, queue as follow-up
          await this.session.followUp(prompt);
        } else {
          await this.session.prompt(prompt);
        }
        this.log.info(`pi-session: runCycle — prompt completed`);
      } catch (promptErr) {
        this.log.error(`pi-session: prompt failed: ${promptErr}`);
      }

    } catch (err) {
      this.log.error(`pi-session: cycle error: ${err}`);
    } finally {
      this.running = false;
      if (this.pendingTriggers.length > 0 && !this.stopped) {
        setTimeout(() => void this.runCycle(), 1000);
      }
    }
  }

  // ─── Session event handler ──────────────────────────────

  private handleSessionEvent(event: any): void {
    // Debug: log all event types with full detail
    const extra: string[] = [];
    if (event.stopReason !== undefined) extra.push(`stopReason=${JSON.stringify(event.stopReason)}`);
    if (event.reason !== undefined) extra.push(`reason=${JSON.stringify(event.reason)}`);
    if (event.errorMessage !== undefined) extra.push(`errorMessage=${JSON.stringify(event.errorMessage)}`);
    if (event.error !== undefined) extra.push(`error=${JSON.stringify(String(event.error))}`);
    this.log.info(`pi-session: event type=${event.type}${extra.length ? ` ${extra.join(", ")}` : ""}`);

    switch (event.type) {
      case "message_start":
        if (event.message) {
          const m = event.message;
          this.log.info(`pi-session: message_start role=${m.role}, contentLen=${m.content?.length ?? 0}, model=${m.model ?? "?"}, stopReason=${m.stopReason ?? "?"}`);
        }
        break;

      case "message_end":
        if (event.message) {
          const msg = event.message;
          this.log.info(`pi-session: message_end role=${msg.role}, stopReason=${msg.stopReason ?? "?"}, errorMessage=${msg.errorMessage ?? "none"}, content=${JSON.stringify(msg.content).slice(0, 800)}`);
          if (msg.role === "assistant") {
            const textContent = msg.content?.filter?.((c: any) => c.type === "text") ?? [];
            for (const block of textContent) {
              if (block.text?.trim()) {
                this.log.info(`[pi-session] ${block.text}`);
                this.runtime.contextPropagator.broadcastInference({
                  data: { reasoning: block.text.slice(0, 500) },
                  note: "Pi session reasoning",
                });
              }
            }
          }
        }
        break;

      case "agent_end":
        // Log the full event to see what it contains
        this.log.info(`pi-session: agent_end keys=[${Object.keys(event).join(",")}]`);
        break;

      case "auto_retry_start":
        this.log.info(`pi-session: auto_retry_start — full event: ${JSON.stringify(event).slice(0, 500)}`);
        break;

      case "auto_retry_end":
        this.log.info(`pi-session: auto_retry_end — full event: ${JSON.stringify(event).slice(0, 500)}`);
        break;

      case "tool_execution_start":
        this.log.info(`pi-session: tool ${event.toolName}(${JSON.stringify(event.args).slice(0, 120)})`);
        break;

      case "tool_execution_end":
        if (event.isError) {
          this.log.warn(`pi-session: tool ${event.toolName} error`);
        }
        break;

      case "auto_compaction_start":
        this.log.info(`pi-session: auto-compaction triggered (${event.reason})`);
        break;

      case "auto_compaction_end":
        if (event.result) {
          this.log.info(`pi-session: compaction done`);
        } else if (event.aborted) {
          this.log.info(`pi-session: compaction aborted`);
        }
        break;
    }
  }

  // ─── Model resolution ───────────────────────────────────

  private resolveModel(spec: string): Model<any> {
    const [provider, ...rest] = spec.split("/");
    const modelId = rest.join("/");

    if (!provider || !modelId) {
      throw new Error(
        `Invalid model spec "${spec}". Use "provider/model-id" (e.g. "anthropic/claude-sonnet-4-5-20250929")`,
      );
    }

    const model = getModel(provider as any, modelId as any);
    if (!model) {
      throw new Error(
        `Model "${modelId}" not found for provider "${provider}". ` +
        `Check available models with: pi-ai models ${provider}`,
      );
    }
    return model;
  }

  // ─── System prompt ──────────────────────────────────────

  private buildSystemPrompt(): string {
    const nodeName = this.runtime.displayName ?? this.runtime.identity.deviceId.slice(0, 12);
    const farm = this.farmContext;

    let farmSection = "";
    if (farm) {
      const zones = farm.zones.map((z) =>
        `  - ${z.zoneId}: ${z.name}${z.crops ? ` (crops: ${z.crops.join(", ")})` : ""}`,
      ).join("\n");
      const assets = farm.assets.map((a) =>
        `  - ${a.assetId}: ${a.type}${a.capabilities ? ` [${a.capabilities.join(",")}]` : ""}`,
      ).join("\n");
      const safety = farm.safetyRules.map((r) => `  - ${r}`).join("\n");

      farmSection = `
# Farm: ${farm.siteName}
## Zones
${zones}
## Assets
${assets}
## Safety Rules (NEVER violate)
${safety}
`;
    }

    return `You are the intelligent planner for a ClawMesh farm mesh network.

# Your Node
- Name: ${nodeName}
- Role: planner / command center
${farmSection}
# Rules
- LLM alone NEVER triggers physical actuation — use propose_task
- Always cite sensor data in reasoning
- Never fabricate sensor values
- L0=auto, L1=bounded auto, L2=human confirm, L3=on-site verify

Be concise. Be safe. Explain your reasoning.`;
  }
}
