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
import { PatternMemory } from "./pattern-memory.js";

// ─── Types ──────────────────────────────────────────────────────────

/**
 * Operational mode for the PiSession.
 *
 * - active:    Normal operation. LLM calls proceed.
 * - observing: Rate-limited or transient errors detected. World model
 *              continues ingesting, thresholds fire (queued), but NO
 *              LLM calls are made. After a cooldown period, a single
 *              probe call is attempted. If it succeeds → active.
 * - suspended: Hard block (403 / account disabled / permanent error).
 *              No LLM calls until manually resumed via `resume()`.
 */
export type SessionMode = "active" | "observing" | "suspended";

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
  /** Errors before entering observing mode. */
  errorThreshold?: number;
  /** Cooldown in observing mode before a probe call (ms). Default: 15 min. */
  observingCooldownMs?: number;
  /** Callbacks. */
  onProposalCreated?: (proposal: TaskProposal) => void;
  onProposalResolved?: (proposal: TaskProposal) => void;
  onAgentEvent?: (event: AgentEvent) => void;
  onModeChange?: (mode: SessionMode, reason: string) => void;
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
  readonly patternMemory: PatternMemory;

  private session!: AgentSession;
  private pendingTriggers: Array<{
    reason: string;
    frames: ContextFrame[];
    conversationId?: string;
    requestId?: string;
    type: "operator_intent" | "threshold_breach" | "proactive_check";
  }> = [];
  private thresholdLastFired = new Map<string, number>();
  private proactiveTimer?: ReturnType<typeof setInterval>;
  private probeTimer?: ReturnType<typeof setTimeout>;
  private running = false;
  private stopped = false;
  private initialized = false;
  private model: Model<any>;
  private thinkingLevel: ThinkingLevel;

  // ─── Rate-limit / observation mode state ────────────────
  private _mode: SessionMode = "active";
  private consecutiveErrors = 0;
  private lastErrorTime = 0;
  private suspendReason = "";
  /** Errors before entering observing mode. */
  private readonly errorThreshold: number;
  /** Cooldown before probe in observing mode (ms). */
  private readonly observingCooldownMs: number;
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
    this.errorThreshold = opts.errorThreshold ?? 3;
    this.observingCooldownMs = opts.observingCooldownMs ?? 15 * 60_000; // 15 minutes
    this.patternMemory = new PatternMemory({ log: this.log });

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

  // ─── Mode management ───────────────────────────────────

  /** Current operational mode. */
  get mode(): SessionMode {
    return this._mode;
  }

  /**
   * Transition to a new mode. Logs the change and notifies callback.
   * Only logs/notifies if the mode actually changed.
   */
  private setMode(newMode: SessionMode, reason: string): void {
    const prev = this._mode;
    if (prev === newMode) return;
    this._mode = newMode;
    this.suspendReason = newMode === "suspended" ? reason : "";

    if (newMode === "active") {
      this.log.info(`[pi-session] MODE: active — ${reason}. LLM calls resumed.`);
    } else if (newMode === "observing") {
      const cooldownMin = Math.round(this.observingCooldownMs / 60_000);
      this.log.warn(
        `[pi-session] MODE: observing — ${reason}. ` +
        `LLM calls paused. World model still ingesting. ` +
        `Will probe in ${cooldownMin} min.`,
      );
      this.scheduleProbe();
    } else {
      this.log.error(
        `[pi-session] MODE: suspended — ${reason}. ` +
        `All LLM calls stopped. Use 'resume' command to re-enable.`,
      );
      this.clearProbeTimer();
    }

    this.opts.onModeChange?.(newMode, reason);
  }

  /**
   * Schedule a single probe call after the observing cooldown.
   * If the probe succeeds → active. If it fails → stay observing, reschedule.
   */
  private scheduleProbe(): void {
    this.clearProbeTimer();
    this.probeTimer = setTimeout(() => {
      if (this._mode !== "observing" || this.stopped) return;
      this.log.info(`[pi-session] Probe: attempting one LLM call to check availability...`);
      void this.runProbe();
    }, this.observingCooldownMs);
  }

  private clearProbeTimer(): void {
    if (this.probeTimer) {
      clearTimeout(this.probeTimer);
      this.probeTimer = undefined;
    }
  }

  /**
   * A lightweight probe — sends a minimal prompt to see if the provider responds.
   * On success: transition to active and drain any queued triggers.
   * On failure: stay observing and reschedule.
   */
  private async runProbe(): Promise<void> {
    if (this.running || !this.initialized) {
      // If a cycle is already running somehow, reschedule
      this.scheduleProbe();
      return;
    }
    this.running = true;
    try {
      await this.session.prompt("Status check. Reply with one word: OK");
      const msgs = this.session.state.messages;
      const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      const hasContent = lastMsg?.role === "assistant" &&
        lastMsg.content?.some((c: any) =>
          (c.type === "text" && c.text?.trim()) || c.type === "toolCall"
        );

      if (hasContent) {
        this.consecutiveErrors = 0;
        this.lastErrorTime = 0;
        this.setMode("active", "probe succeeded — provider is available");
        // Drain queued triggers
        if (this.pendingTriggers.length > 0 && !this.stopped) {
          setTimeout(() => void this.runCycle(), 1000);
        }
      } else {
        this.handleLLMFailure("probe returned empty content", false);
      }
    } catch (err) {
      this.handleLLMFailure(`probe failed: ${err}`, this.isPermanentError(err));
    } finally {
      this.running = false;
    }
  }

  /**
   * Central handler for LLM failures. Decides whether to stay observing or suspend.
   */
  private handleLLMFailure(reason: string, permanent: boolean): void {
    this.consecutiveErrors++;
    this.lastErrorTime = Date.now();

    if (permanent) {
      this.setMode("suspended", reason);
      return;
    }

    if (this._mode === "active" && this.consecutiveErrors >= this.errorThreshold) {
      this.setMode("observing", `${this.consecutiveErrors} consecutive errors — ${reason}`);
    } else if (this._mode === "observing") {
      // Still observing — reschedule probe
      this.log.warn(`[pi-session] Probe failed (${reason}). Will retry in ${Math.round(this.observingCooldownMs / 60_000)} min.`);
      this.scheduleProbe();
    }
    // If still active but below threshold, just log
    if (this._mode === "active") {
      this.log.warn(`[pi-session] LLM error ${this.consecutiveErrors}/${this.errorThreshold}: ${reason}`);
    }
  }

  /**
   * Check if an error is permanent (403 / account disabled / terms violation).
   * These should suspend the session entirely.
   */
  private isPermanentError(err: unknown): boolean {
    const msg = String(err).toLowerCase();
    return (
      msg.includes("403") ||
      msg.includes("forbidden") ||
      msg.includes("disabled") ||
      msg.includes("terms of service") ||
      msg.includes("account") ||
      msg.includes("unauthorized") ||
      msg.includes("401")
    );
  }

  /**
   * Manually resume from suspended or observing mode.
   * Resets error counters and returns to active.
   */
  resume(reason = "manual resume"): void {
    this.consecutiveErrors = 0;
    this.lastErrorTime = 0;
    this.clearProbeTimer();
    this.setMode("active", reason);
    // Drain queued triggers
    if (this.pendingTriggers.length > 0 && !this.stopped) {
      setTimeout(() => void this.runCycle(), 1000);
    }
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
    this.clearProbeTimer();
    this.runtime.worldModel.onIngest = undefined;
    if (this.initialized) {
      void this.session.abort();
    }
    this.log.info("pi-session: stopped");
  }

  // ─── External triggers ─────────────────────────────────

  handleOperatorIntent(text: string, opts?: { conversationId?: string; requestId?: string }): void {
    const conversationId = opts?.conversationId;
    const requestId = opts?.requestId;

    if (this._mode !== "active") {
      this.log.warn(`[pi-session] Operator intent received but mode is '${this._mode}'. Queuing — use 'resume' to re-enable LLM calls.`);
      this.pendingTriggers.push({
        reason: `operator_intent: "${text}"`,
        frames: [],
        conversationId,
        requestId,
        type: "operator_intent",
      });
      return;
    }

    // Broadcast "thinking" status to UI
    if (conversationId) {
      this.broadcastAgentResponse({
        conversationId,
        requestId,
        message: "",
        status: "thinking",
      });
    }

    this.pendingTriggers.push({
      reason: `operator_intent: "${text}"`,
      frames: [],
      conversationId,
      requestId,
      type: "operator_intent",
    });
    void this.runCycle();
  }

  /**
   * Broadcast an agent response frame to UI subscribers and mesh peers.
   */
  private broadcastAgentResponse(data: {
    conversationId?: string;
    requestId?: string;
    message: string;
    status: "complete" | "thinking" | "error";
    proposals?: string[];
    citations?: Array<{ metric: string; value: unknown; zone?: string; timestamp: number }>;
  }): void {
    // Send only to UI subscribers (not via context propagator to avoid duplicates)
    this.runtime.broadcastToUI("context.frame", {
      kind: "agent_response",
      frameId: `ar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sourceDeviceId: this.runtime.identity.deviceId,
      sourceDisplayName: this.runtime.displayName,
      timestamp: Date.now(),
      data,
      trust: { evidence_sources: ["llm"], evidence_trust_tier: "T0_planning_inference" },
    });
  }

  async approveProposal(taskId: string, approvedBy = "operator"): Promise<TaskProposal | null> {
    const proposal = this.extensionState.proposals.get(taskId);
    if (!proposal || proposal.status !== "awaiting_approval") return null;

    proposal.status = "approved";
    proposal.resolvedBy = approvedBy;

    // Record approval in pattern memory
    this.patternMemory.recordDecision({
      approved: true,
      triggerCondition: proposal.reasoning || proposal.summary,
      action: {
        operation: proposal.operation,
        targetRef: proposal.targetRef,
        operationParams: proposal.operationParams,
        summary: proposal.summary,
      },
      triggerEventId: proposal.triggerFrameIds?.[0],
    });

    // Check if pattern should be gossiped
    this.gossipPatternsIfReady();

    if (this._mode !== "active") {
      this.log.warn(`[pi-session] Proposal approved but mode is '${this._mode}'. Execution deferred — use 'resume' to re-enable LLM calls.`);
      return proposal;
    }

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

    // Record rejection in pattern memory
    this.patternMemory.recordDecision({
      approved: false,
      triggerCondition: proposal.reasoning || proposal.summary,
      action: {
        operation: proposal.operation,
        targetRef: proposal.targetRef,
        operationParams: proposal.operationParams,
        summary: proposal.summary,
      },
      triggerEventId: proposal.triggerFrameIds?.[0],
    });

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

  /**
   * Gossip learned patterns to mesh peers when they cross the confidence threshold.
   */
  private gossipPatternsIfReady(): void {
    const exportable = this.patternMemory.exportPatterns();
    if (exportable.length === 0) return;

    this.runtime.contextPropagator.broadcast({
      kind: "capability_update",
      data: {
        type: "learned_patterns",
        patterns: exportable,
      },
      trust: {
        evidence_sources: ["human", "llm"],
        evidence_trust_tier: "T2_operational_observation",
      },
      note: `${exportable.length} learned patterns from operator decisions`,
    });

    this.log.info(`[pi-session] Gossiped ${exportable.length} learned patterns to mesh`);
  }

  // ─── Context handlers ──────────────────────────────────

  private handleIncomingFrame(frame: ContextFrame): void {
    // Import learned patterns from remote peers
    if (frame.kind === "capability_update" && frame.data.type === "learned_patterns") {
      const patterns = frame.data.patterns as any[];
      if (Array.isArray(patterns)) {
        this.patternMemory.importPatterns(patterns, frame.sourceDeviceId);
      }
      return;
    }

    // In observing/suspended mode, only log threshold breaches (not every frame)
    if (this._mode === "active") {
      this.log.info(`pi-session: incoming ${frame.kind} — metric=${frame.data.metric}, value=${frame.data.value}, thresholds=${this.extensionState.thresholds.length}`);
    }
    for (const rule of this.extensionState.thresholds) {
      if (this.checkThresholdRule(rule, frame)) {
        this.log.info(`pi-session: THRESHOLD BREACH — ${rule.ruleId}: value=${frame.data.value}${this._mode !== "active" ? ` (queued — mode=${this._mode})` : ""}`);
        this.pendingTriggers.push({
          reason: `threshold_breach: ${rule.ruleId} — ${rule.promptHint}`,
          frames: [frame],
          type: "threshold_breach",
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
    if (this._mode !== "active") return; // Silent skip in observing/suspended
    const recentFrames = this.runtime.worldModel.getRecentFrames(5);
    if (recentFrames.length === 0) return;
    this.pendingTriggers.push({
      reason: "proactive_check: periodic farm state review",
      frames: recentFrames,
      type: "proactive_check",
    });
    void this.runCycle();
  }

  // ─── Planner cycle ─────────────────────────────────────

  private async runCycle(): Promise<void> {
    if (this.running || this.stopped || !this.initialized) return;

    // Mode gate: only active mode makes LLM calls
    if (this._mode !== "active") {
      // Silently accumulate triggers — they'll drain when we go active
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

      // Separate operator intents from system triggers
      const operatorIntents = triggers.filter(t => t.type === "operator_intent");
      const systemTriggers = triggers.filter(t => t.type !== "operator_intent");

      let prompt: string;
      let activeConversationId: string | undefined;
      let activeRequestId: string | undefined;

      if (operatorIntents.length > 0) {
        // Use conversational format for operator intents
        const intent = operatorIntents[0]; // Process first intent conversationally
        activeConversationId = intent.conversationId;
        activeRequestId = intent.requestId;
        const intentText = intent.reason.replace(/^operator_intent:\s*"?|"?\s*$/g, "");

        const systemContext = systemTriggers.length > 0
          ? `\n\nAdditionally, the following system triggers occurred:\n${systemTriggers.map(t => `- ${t.reason}`).join("\n")}`
          : "";

        // Include learned patterns as context
        const allPatterns = this.patternMemory.getAllPatterns();
        const patternContext = allPatterns.length > 0
          ? `\n\n[LEARNED PATTERNS from past operator decisions]\n${allPatterns.slice(0, 10).map(p =>
              `- "${p.triggerCondition}" → ${p.action.operation} on ${p.action.targetRef} ` +
              `(confidence: ${(p.confidence * 100).toFixed(0)}%, approved ${p.approvalCount}x, rejected ${p.rejectionCount}x)`
            ).join("\n")}`
          : "";

        prompt = `[OPERATOR MESSAGE] "${intentText}"${systemContext}${patternContext}

Respond naturally to the operator's message. Use your tools to check current sensor data if relevant. If the operator is asking for information, provide it clearly with sensor citations. If they're requesting an action that requires actuation, use propose_task. Be conversational but concise. If learned patterns are relevant, mention them.`;

        // Queue remaining operator intents for next cycle
        for (let i = 1; i < operatorIntents.length; i++) {
          this.pendingTriggers.push(operatorIntents[i]);
        }
      } else {
        // Standard planner cycle for system triggers
        const triggerSummary = systemTriggers.map((t) => `- ${t.reason}`).join("\n");
        prompt = `[PLANNER CYCLE ${new Date().toISOString()}]
Triggers:
${triggerSummary}

Review the current mesh state using your tools, then either:
1. Take no action if everything is within acceptable parameters
2. Use propose_task to create proposals for actions that need human approval (L2/L3 actuation)
3. For safe read-only operations (L0), execute them directly

Always explain your reasoning. Never fabricate sensor data.`;
      }

      const toolsNow = this.session.getActiveToolNames();
      const msgCount = this.session.state.messages.length;
      this.log.info(`pi-session: runCycle — sending prompt (tools=${toolsNow.length}, messages=${msgCount})`);

      try {
        if (this.session.isStreaming) {
          await this.session.followUp(prompt);
        } else {
          await this.session.prompt(prompt);
        }

        // Check if the LLM actually produced content (vs rate-limit / error)
        const msgs = this.session.state.messages;
        const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        const hasContent = lastMsg?.role === "assistant" &&
          lastMsg.content?.some((c: any) =>
            (c.type === "text" && c.text?.trim()) || c.type === "toolCall"
          );

        if (hasContent) {
          // Success — reset error tracking
          if (this.consecutiveErrors > 0) {
            this.log.info(`pi-session: LLM responded successfully after ${this.consecutiveErrors} error(s)`);
          }
          this.consecutiveErrors = 0;
          this.lastErrorTime = 0;

          // Extract full assistant text and broadcast as agent_response
          if (activeConversationId && lastMsg?.role === "assistant") {
            const textBlocks = lastMsg.content?.filter?.((c: any) => c.type === "text") ?? [];
            const fullText = textBlocks.map((c: any) => c.text?.trim()).filter(Boolean).join("\n\n");

            // Collect proposal IDs created during this turn
            const proposalIds: string[] = [];
            for (const [taskId, proposal] of this.extensionState.proposals.entries()) {
              if (proposal.createdAt >= Date.now() - 10_000) {
                proposalIds.push(taskId);
              }
            }

            // Build sensor citations from recent world model frames
            const recentFrames = this.runtime.worldModel.getRecentFrames(10);
            const citations = recentFrames
              .filter(f => f.kind === "observation" && f.data.metric)
              .slice(0, 5)
              .map(f => ({
                metric: String(f.data.metric),
                value: f.data.value,
                zone: f.data.zone as string | undefined,
                timestamp: f.timestamp,
              }));

            if (fullText) {
              this.broadcastAgentResponse({
                conversationId: activeConversationId,
                requestId: activeRequestId,
                message: fullText,
                status: "complete",
                proposals: proposalIds.length > 0 ? proposalIds : undefined,
                citations: citations.length > 0 ? citations : undefined,
              });
            }
          }
        } else {
          // Empty content — likely rate limit or silent error
          this.handleLLMFailure("LLM returned no content (possible rate limit)", false);
          if (activeConversationId) {
            this.broadcastAgentResponse({
              conversationId: activeConversationId,
              requestId: activeRequestId,
              message: "I'm having trouble responding right now. The system may be rate-limited. Please try again shortly.",
              status: "error",
            });
          }
        }
      } catch (promptErr) {
        this.handleLLMFailure(`prompt failed: ${promptErr}`, this.isPermanentError(promptErr));
        if (activeConversationId) {
          this.broadcastAgentResponse({
            conversationId: activeConversationId,
            requestId: activeRequestId,
            message: `An error occurred while processing your request: ${String(promptErr).slice(0, 200)}`,
            status: "error",
          });
        }
      }

    } catch (err) {
      this.log.error(`pi-session: cycle error: ${err}`);
    } finally {
      this.running = false;
      // Only drain queue if still active
      if (this._mode === "active" && this.pendingTriggers.length > 0 && !this.stopped) {
        setTimeout(() => void this.runCycle(), 2000);
      }
    }
  }

  // ─── Session event handler ──────────────────────────────

  private handleSessionEvent(event: any): void {
    switch (event.type) {
      // Silently skip high-frequency streaming updates
      case "message_update":
        return;

      case "message_start":
        if (event.message) {
          const m = event.message;
          if (m.role === "assistant" && m.model) {
            this.log.info(`pi-session: LLM responding (model=${m.model})`);
          }
        }
        break;

      case "message_end":
        if (event.message) {
          const msg = event.message;
          // Log errors explicitly so we catch rate limits
          if (msg.errorMessage) {
            this.log.error(`pi-session: message error: ${msg.errorMessage}`);
          }
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
            const toolCalls = msg.content?.filter?.((c: any) => c.type === "toolCall") ?? [];
            if (toolCalls.length > 0) {
              this.log.info(`pi-session: tool calls: ${toolCalls.map((t: any) => t.name).join(", ")}`);
            }
          }
        }
        break;

      case "tool_execution_start":
        this.log.info(`pi-session: tool ${event.toolName}(${JSON.stringify(event.args).slice(0, 120)})`);
        break;

      case "tool_execution_end":
        if (event.isError) {
          this.log.warn(`pi-session: tool ${event.toolName} error`);
        }
        break;

      case "auto_retry_start":
        this.log.warn(`pi-session: auto-retry starting`);
        break;

      case "auto_compaction_start":
        this.log.info(`pi-session: auto-compaction triggered`);
        break;

      case "auto_compaction_end":
        if (event.result) {
          this.log.info(`pi-session: compaction done`);
        }
        break;

      // agent_start, agent_end, turn_start, turn_end, auto_retry_end — skip silently
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
