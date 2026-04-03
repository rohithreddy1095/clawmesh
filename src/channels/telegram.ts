/**
 * ClawMesh Telegram Channel — mesh-native channel adapter.
 *
 * This is a thin mesh-native bridge, not a heavyweight plugin system.
 * It's a thin bridge between a Telegram bot (via grammy) and the ClawMesh
 * mesh. Messages become context frames, agent responses become replies.
 *
 * Architecture:
 *   Telegram message → human_input frame → Pi planner → agent_response → Telegram reply
 *   Proposal created → Telegram message with inline approve/reject buttons
 *   Threshold breach → Telegram alert notification
 *
 * The bot connects via long-polling (no webhook, no public IP needed) and
 * only talks to allowed chat IDs (allowlist). This makes it safe for
 * farm operators who can message the farm bot from anywhere.
 */

import { Bot, InlineKeyboard, type Context as GrammyContext } from "grammy";
import type { MeshNodeRuntime } from "../mesh/node-runtime.js";
import type { PiSession } from "../agents/pi-session.js";
import type { ContextFrame } from "../mesh/context-types.js";
import type { TaskProposal } from "../agents/types.js";
import { buildProposalDecisionNotice, formatPendingProposalStatusLines, formatProposalSummaryLine } from "../agents/proposal-formatting.js";
import { randomUUID } from "node:crypto";

// ─── Types ──────────────────────────────────────────────────

export type TelegramChannelOptions = {
  /** Telegram Bot API token (from @BotFather). */
  token: string;
  /** Mesh node runtime. */
  runtime: MeshNodeRuntime;
  /** Allowed Telegram chat IDs. Only these chats can interact. Empty = allow all. */
  allowedChatIds?: number[];
  /** Whether to forward context alerts (threshold breaches) to Telegram. Default: true. */
  forwardAlerts?: boolean;
  /** Whether to forward all agent_response frames to Telegram. Default: true. */
  forwardAgentResponses?: boolean;
  /** Minimum severity for alert forwarding. Default: "low". */
  alertMinSeverity?: "normal" | "low" | "critical";
  /** Logger. */
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};

/** Tracks a conversation between a Telegram chat and the mesh. */
type TelegramConversation = {
  chatId: number;
  conversationId: string;
  lastActivity: number;
};

/** Tracks a pending proposal notification sent to Telegram. */
type ProposalNotification = {
  taskId: string;
  chatId: number;
  messageId: number;
};

// ─── TelegramChannel ────────────────────────────────────────

export class TelegramChannel {
  private readonly bot: Bot;
  private readonly runtime: MeshNodeRuntime;
  private readonly allowedChatIds: Set<number>;
  private readonly forwardAlerts: boolean;
  private readonly forwardAgentResponses: boolean;
  private readonly alertMinSeverity: string;
  private readonly log: NonNullable<TelegramChannelOptions["log"]>;

  /** Chat ID → active conversation. */
  private conversations = new Map<number, TelegramConversation>();
  /** conversationId → chat ID (reverse lookup for agent responses). */
  private conversationToChatId = new Map<string, number>();
  /** taskId → notification message (for inline button callbacks). */
  private proposalNotifications = new Map<string, ProposalNotification>();
  /** Chat IDs that have opted in to receive alerts. */
  private alertSubscribers = new Set<number>();
  /** Frame IDs we've already alerted on (prevent duplicate alerts). */
  private alertedFrameIds = new Set<string>();
  /** Alert polling timer. */
  private alertTimer: ReturnType<typeof setInterval> | null = null;

  private running = false;

  constructor(opts: TelegramChannelOptions) {
    this.bot = new Bot(opts.token);
    this.runtime = opts.runtime;
    this.allowedChatIds = new Set(opts.allowedChatIds ?? []);
    this.forwardAlerts = opts.forwardAlerts ?? true;
    this.forwardAgentResponses = opts.forwardAgentResponses ?? true;
    this.alertMinSeverity = opts.alertMinSeverity ?? "low";
    this.log = opts.log ?? {
      info: (msg) => console.log(msg),
      warn: (msg) => console.warn(msg),
      error: (msg) => console.error(msg),
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;

    this.registerHandlers();
    this.wireRuntimeHooks();

    // Note: channel:telegram capability is announced via the CLI when Telegram is enabled.
    // The runtime's capabilities list is set at construction time.

    // Start long-polling (no webhook needed).
    // Catch polling errors (e.g. 409 conflict from another bot instance)
    // so they don't crash the entire process.
    this.bot.catch((err) => {
      this.log.warn(`[telegram] Bot error (non-fatal): ${err.message ?? err}`);
    });
    this.bot.start({
      onStart: (info) => {
        this.log.info(`[telegram] Bot @${info.username} started (long-polling). Allowed chats: ${this.allowedChatIds.size || "all"}`);
      },
    }).catch((err) => {
      this.log.warn(`[telegram] Polling stopped: ${err.message ?? err}. Mesh node continues without Telegram.`);
      this.running = false;
    });

    this.running = true;
    this.log.info("[telegram] Channel started");
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.alertTimer) {
      clearInterval(this.alertTimer);
      this.alertTimer = null;
    }
    await this.bot.stop();
    this.log.info("[telegram] Channel stopped");
  }

  // ─── Bot Handlers ───────────────────────────────────────

  private registerHandlers(): void {
    // Access control middleware
    this.bot.use(async (ctx, next) => {
      const chatId = ctx.chat?.id;
      if (!chatId) return;

      // If allowlist is set, enforce it
      if (this.allowedChatIds.size > 0 && !this.allowedChatIds.has(chatId)) {
        this.log.warn(`[telegram] Blocked message from unauthorized chat ${chatId}`);
        await ctx.reply("⛔ This bot is not authorized for this chat. Contact the farm operator.");
        return;
      }

      await next();
    });

    // /start command
    this.bot.command("start", async (ctx) => {
      const nodeName = this.runtime.displayName ?? "ClawMesh Node";
      const peers = this.runtime.peerRegistry.listConnected();
      const caps = this.runtime.getAdvertisedCapabilities();

      await ctx.reply(
        `🌱 *${this.escMd(nodeName)}* — ClawMesh Farm Bot\n\n` +
        `Connected peers: ${peers.length}\n` +
        `Capabilities: ${caps.join(", ")}\n\n` +
        `*Commands:*\n` +
        `/status — Mesh status & world model\n` +
        `/proposals — List pending proposals\n` +
        `/world — Recent sensor observations\n` +
        `/alerts — Subscribe to threshold alerts\n` +
        `/help — Show this message\n\n` +
        `Or just type a message and I'll ask the farm planner\\.`,
        { parse_mode: "MarkdownV2" },
      );
    });

    // /help command
    this.bot.command("help", async (ctx) => {
      await ctx.reply(
        `🔧 *ClawMesh Commands*\n\n` +
        `/status — Mesh peers, capabilities, planner mode\n` +
        `/proposals — Show task proposals \\(pending/approved/rejected\\)\n` +
        `/world — Recent world model observations\n` +
        `/alerts — Toggle threshold alert notifications\n` +
        `/approve \\<id\\> — Approve a pending proposal\n` +
        `/reject \\<id\\> — Reject a pending proposal\n\n` +
        `*Natural language:* Just type anything to talk to the planner\\.\n` +
        `Examples:\n` +
        `• "What's the soil moisture in zone\\-1?"\n` +
        `• "Start irrigation pump P1"\n` +
        `• "Give me a morning farm report"`,
        { parse_mode: "MarkdownV2" },
      );
    });

    // /status command
    this.bot.command("status", async (ctx) => {
      const peers = this.runtime.peerRegistry.listConnected();
      const caps = this.runtime.getAdvertisedCapabilities();
      const pi = this.runtime.piSession;
      const mode = pi ? pi.mode.toUpperCase() : "BASIC (no planner)";
      const frameCount = this.runtime.worldModel.getRecentFrames(100).length;
      const proposals = pi ? pi.getProposals() : [];
      const pending = proposals.filter(p => p.status === "awaiting_approval").length;
      const plannerLeader = this.runtime.getPlannerLeader();
      const leader = plannerLeader.kind === "none"
        ? undefined
        : {
            deviceId: plannerLeader.deviceId,
            role: plannerLeader.role === "planner" || plannerLeader.role === "standby-planner"
              ? plannerLeader.role
              : undefined,
          };

      const peerLines = peers.length > 0
        ? peers.map(p => `  • ${p.displayName ?? p.deviceId.slice(0, 12)} [${p.capabilities.join(", ")}]`).join("\n")
        : "  (no peers connected)";
      const pendingLines = formatPendingProposalStatusLines(proposals, { leader });
      const pendingSection = pendingLines.length > 0
        ? `\nTop pending:\n${pendingLines.join("\n")}`
        : "";

      await ctx.reply(
        `📊 Mesh Status\n\n` +
        `Mode: ${mode}\n` +
        `Peers (${peers.length}):\n${peerLines}\n` +
        `Local capabilities: ${caps.join(", ")}\n` +
        `World model: ${frameCount} frames\n` +
        `Proposals: ${proposals.length} total, ${pending} awaiting approval${pendingSection}`,
      );
    });

    // /world command
    this.bot.command("world", async (ctx) => {
      const entries = this.runtime.worldModel.getAll();
      if (entries.length === 0) {
        await ctx.reply("🌍 World model is empty — waiting for sensor observations.");
        return;
      }

      const lines = entries.slice(0, 10).map(e => {
        const d = e.lastFrame.data;
        const time = new Date(e.lastFrame.timestamp).toLocaleTimeString();
        if (d.zone && d.metric && d.value !== undefined) {
          const status = d.status ? ` (${d.status})` : "";
          return `${time} │ ${d.zone} ${d.metric}: ${d.value}${d.unit ?? ""}${status}`;
        }
        return `${time} │ ${e.lastFrame.kind}: ${JSON.stringify(d).slice(0, 60)}`;
      });

      await ctx.reply(
        `🌍 World Model (${entries.length} entries)\n\n` +
        `\`\`\`\n${lines.join("\n")}\n\`\`\``,
        { parse_mode: "Markdown" },
      );
    });

    // /proposals command
    this.bot.command("proposals", async (ctx) => {
      const pi = this.runtime.piSession;
      if (!pi) {
        await ctx.reply("No planner active. Start with --pi-planner to enable proposals.");
        return;
      }

      const proposals = pi.getProposals();
      if (proposals.length === 0) {
        await ctx.reply("📋 No proposals.");
        return;
      }

      const plannerLeader = this.runtime.getPlannerLeader();
      const leader = plannerLeader.kind === "none"
        ? undefined
        : {
            deviceId: plannerLeader.deviceId,
            role: plannerLeader.role === "planner" || plannerLeader.role === "standby-planner"
              ? plannerLeader.role
              : undefined,
          };
      const lines = proposals.slice(-10).map(p => {
        const icon = p.status === "awaiting_approval" ? "⚠️"
          : p.status === "approved" || p.status === "completed" ? "✅"
          : p.status === "rejected" ? "❌"
          : p.status === "executing" ? "⏳"
          : "·";
        return `${icon} ${formatProposalSummaryLine(p, { leader })}`;
      });

      await ctx.reply(`📋 Proposals (${proposals.length})\n\n${lines.join("\n\n")}`);
    });

    // /approve <id> command
    this.bot.command("approve", async (ctx) => {
      const pi = this.runtime.piSession;
      if (!pi) { await ctx.reply("No planner active."); return; }

      const prefix = ctx.match?.trim();
      if (!prefix) { await ctx.reply("Usage: /approve <task-id-prefix>"); return; }

      const match = pi.getProposals({ status: "awaiting_approval" })
        .find(p => p.taskId.startsWith(prefix));
      if (!match) {
        await ctx.reply(`No awaiting proposal matching "${prefix}"`);
        return;
      }

      const result = await pi.approveProposal(match.taskId, `telegram:${ctx.from?.id ?? "unknown"}`);
      if (result) {
        await ctx.reply(`✅ ${buildProposalDecisionNotice("Approved", match)}\nTask: ${match.taskId.slice(0, 8)}`);
        this.updateProposalNotification(match.taskId, "approved");
      } else {
        await ctx.reply("Approval failed.");
      }
    });

    // /reject <id> command
    this.bot.command("reject", async (ctx) => {
      const pi = this.runtime.piSession;
      if (!pi) { await ctx.reply("No planner active."); return; }

      const prefix = ctx.match?.trim();
      if (!prefix) { await ctx.reply("Usage: /reject <task-id-prefix>"); return; }

      const match = pi.getProposals({ status: "awaiting_approval" })
        .find(p => p.taskId.startsWith(prefix));
      if (!match) {
        await ctx.reply(`No awaiting proposal matching "${prefix}"`);
        return;
      }

      const result = pi.rejectProposal(match.taskId, `telegram:${ctx.from?.id ?? "unknown"}`);
      if (result) {
        await ctx.reply(`❌ ${buildProposalDecisionNotice("Rejected", match)}\nTask: ${match.taskId.slice(0, 8)}`);
        this.updateProposalNotification(match.taskId, "rejected");
      } else {
        await ctx.reply("Rejection failed.");
      }
    });

    // /alerts command — toggle alert subscription
    this.bot.command("alerts", async (ctx) => {
      const chatId = ctx.chat.id;
      if (this.alertSubscribers.has(chatId)) {
        this.alertSubscribers.delete(chatId);
        await ctx.reply("🔕 Alert notifications disabled for this chat.");
      } else {
        this.alertSubscribers.add(chatId);
        await ctx.reply("🔔 Alert notifications enabled! You'll receive threshold breach alerts.");
      }
    });

    // Inline keyboard callbacks (approve/reject buttons)
    this.bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
      const taskId = ctx.match[1];
      const pi = this.runtime.piSession;
      if (!pi) { await ctx.answerCallbackQuery("No planner active"); return; }

      const result = await pi.approveProposal(taskId, `telegram:${ctx.from.id}`);
      if (result) {
        await ctx.answerCallbackQuery("✅ Approved");
        this.updateProposalNotification(taskId, "approved");
      } else {
        await ctx.answerCallbackQuery("Failed — proposal may no longer be pending");
      }
    });

    this.bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
      const taskId = ctx.match[1];
      const pi = this.runtime.piSession;
      if (!pi) { await ctx.answerCallbackQuery("No planner active"); return; }

      const result = pi.rejectProposal(taskId, `telegram:${ctx.from.id}`);
      if (result) {
        await ctx.answerCallbackQuery("❌ Rejected");
        this.updateProposalNotification(taskId, "rejected");
      } else {
        await ctx.answerCallbackQuery("Failed — proposal may no longer be pending");
      }
    });

    // Natural language messages and channel posts → operator intent
    const handleTextUpdate = async (ctx: GrammyContext) => {
      const text = ctx.msg?.text;
      const chatId = ctx.chat?.id;
      if (!text || !chatId) return;

      const senderName = ctx.from?.first_name
        ?? ("title" in ctx.chat && typeof ctx.chat.title === "string" ? ctx.chat.title : undefined)
        ?? `chat:${chatId}`;

      this.log.info(`[telegram] Message from ${senderName} (chat ${chatId}): "${text.slice(0, 100)}"`);

      // Get or create conversation
      const conv = this.getOrCreateConversation(chatId);

      // Broadcast as human_input context frame
      this.runtime.contextPropagator.broadcastHumanInput({
        data: {
          intent: text,
          conversationId: conv.conversationId,
          source: "telegram",
          senderId: String(ctx.from?.id ?? chatId),
          senderName,
        },
        note: `Telegram message from ${senderName}: "${text.slice(0, 100)}"`,
      });

      // Route to Pi planner
      const pi = this.runtime.piSession;
      if (pi) {
        // Channel posts do not support chat actions like "typing".
        if (ctx.from) {
          await ctx.replyWithChatAction("typing");
        }

        const requestId = randomUUID();
        pi.handleOperatorIntent(text, {
          conversationId: conv.conversationId,
          requestId,
        });

        // The response will come back via the runtime hook (wireRuntimeHooks)
      } else {
        // No planner — basic response
        const worldEntries = this.runtime.worldModel.getAll();
        if (worldEntries.length > 0 && text.toLowerCase().includes("status")) {
          const summary = worldEntries.slice(0, 5).map(e => {
            const d = e.lastFrame.data;
            return d.zone && d.metric ? `${d.zone}: ${d.metric} = ${d.value}${d.unit ?? ""}` : null;
          }).filter(Boolean).join("\n");
          await ctx.reply(`📊 Current readings:\n${summary}\n\n(No planner active — enable with --pi-planner)`);
        } else {
          await ctx.reply("I received your message, but no planner is active. Start with --pi-planner to enable AI responses.");
        }
      }
    };

    this.bot.on("message:text", handleTextUpdate);
    this.bot.on("channel_post:text", handleTextUpdate);

    // Error handler
    this.bot.catch((err) => {
      this.log.error(`[telegram] Bot error: ${err.message}`);
    });
  }

  // ─── Runtime Hooks ──────────────────────────────────────

  /**
   * Wire into the mesh runtime to receive agent responses, proposals, and alerts.
   * We subscribe as a "UI subscriber" (same mechanism as the Web UI) so we get
   * all the same events.
   */
  private wireRuntimeHooks(): void {
    // Subscribe to UI broadcast events (agent responses, proposals)
    const origBroadcast = this.runtime.broadcastToUI.bind(this.runtime);
    this.runtime.broadcastToUI = (event: string, payload: unknown) => {
      // Call original first (serves the Web UI)
      origBroadcast(event, payload);

      // Log that we intercepted it
      const data = payload as Record<string, unknown>;
      if (event === "context.frame" && data.kind === "agent_response") {
        this.log.info(`[telegram] intercepted broadcastToUI: event=${event}, kind=${data.kind}`);
      }

      // Handle events for Telegram
      this.handleRuntimeEvent(event, payload);
    };

    // Hook into world model for threshold alerts.
    // Instead of wrapping onIngest (which races with PiSession), we use a
    // polling approach on the world model's recent frames.
    if (this.forwardAlerts) {
      this.startAlertPolling();
    }
  }

  private handleRuntimeEvent(event: string, payload: unknown): void {
    const data = payload as Record<string, unknown>;

    // Agent response → reply to Telegram conversation
    if (event === "context.frame" && data.kind === "agent_response") {
      if (!this.forwardAgentResponses) return;
      const responseData = data.data as Record<string, unknown>;
      const conversationId = responseData.conversationId as string;
      const status = responseData.status as string;
      const message = responseData.message as string;

      this.log.info(`[telegram] agent_response received — convId=${conversationId}, status=${status}, msgLen=${message?.length ?? 0}`);

      if (!conversationId || status === "thinking" || !message) return;

      const chatId = this.conversationToChatId.get(conversationId);
      this.log.info(`[telegram] chatId lookup for ${conversationId}: ${chatId ?? "NOT FOUND"} (known convs: ${[...this.conversationToChatId.keys()].join(", ")})`);
      if (!chatId) return; // Not a Telegram conversation

      // Format and send the response
      this.sendAgentResponse(chatId, message, responseData).catch(err => {
        this.log.error(`[telegram] sendAgentResponse unhandled error: ${err}`);
      });
    }

    // New proposal → send notification with inline buttons
    if (event === "planner.proposal") {
      const proposal = data as unknown as TaskProposal;
      if (proposal.status === "awaiting_approval") {
        this.sendProposalNotification(proposal).catch(err => {
          this.log.error(`[telegram] sendProposalNotification error: ${err}`);
        });
      }
    }

    // Proposal resolved → update notification
    if (event === "planner.proposal.resolved") {
      const proposal = data as unknown as TaskProposal;
      this.updateProposalNotification(proposal.taskId, proposal.status);
    }
  }

  // ─── Outbound Messages ─────────────────────────────────

  /**
   * Send an agent response to a Telegram chat.
   */
  private async sendAgentResponse(
    chatId: number,
    message: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      // Format citations if present
      const citations = data.citations as Array<{
        metric: string;
        value: unknown;
        zone?: string;
        timestamp: number;
      }> | undefined;

      let text = message;

      if (citations && citations.length > 0) {
        const citationLines = citations.map(c => {
          const time = new Date(c.timestamp).toLocaleTimeString();
          return `📍 ${c.zone ? `${c.zone} ` : ""}${c.metric}: ${c.value} (${time})`;
        });
        text += `\n\n${citationLines.join("\n")}`;
      }

      // Telegram has a 4096 char limit — chunk if needed
      const chunks = this.chunkMessage(text, 4000);
      this.log.info(`[telegram] Sending response to chat ${chatId}: ${chunks.length} chunk(s), ${text.length} chars`);
      for (const chunk of chunks) {
        const result = await this.bot.api.sendMessage(chatId, chunk);
        this.log.info(`[telegram] Sent message ${result.message_id} to chat ${chatId}`);
      }
    } catch (err) {
      this.log.error(`[telegram] Failed to send response to chat ${chatId}: ${err}`);
    }
  }

  /**
   * Send a proposal notification with approve/reject inline buttons.
   */
  private async sendProposalNotification(proposal: TaskProposal): Promise<void> {
    // Send to all active conversations + alert subscribers
    const chatIds = new Set<number>([
      ...this.alertSubscribers,
      ...this.conversations.keys(),
    ]);

    if (chatIds.size === 0) return;

    const keyboard = new InlineKeyboard()
      .text("✅ Approve", `approve:${proposal.taskId}`)
      .text("❌ Reject", `reject:${proposal.taskId}`);

    // Enrich with current sensor context
    const recentFrames = this.runtime.worldModel.getRecentFrames(10);
    const targetZone = proposal.targetRef.split(":").find(p => p.startsWith("zone-"));
    const relevantReadings = recentFrames
      .filter(f => f.kind === "observation" && (!targetZone || f.data.zone === targetZone))
      .slice(0, 3)
      .map(f => `${f.data.zone ?? ""}:${f.data.metric}=${f.data.value}${f.data.unit ?? ""}`)
      .filter(Boolean);

    const sensorContext = relevantReadings.length > 0
      ? `\n*Current readings:*\n${relevantReadings.map(r => `  📊 ${this.escMd(r)}`).join("\n")}\n`
      : "";

    const text =
      `⚠️ *New Proposal* \\[${this.escMd(proposal.approvalLevel)}\\]\n\n` +
      `${this.escMd(proposal.summary)}\n\n` +
      `*Target:* ${this.escMd(proposal.targetRef)}\n` +
      `*Operation:* ${this.escMd(proposal.operation)}\n` +
      `*Task ID:* \`${proposal.taskId.slice(0, 8)}\`\n` +
      sensorContext +
      `\n_${this.escMd(proposal.reasoning?.slice(0, 300) ?? "")}_`;

    for (const chatId of chatIds) {
      try {
        const sent = await this.bot.api.sendMessage(chatId, text, {
          parse_mode: "MarkdownV2",
          reply_markup: keyboard,
        });
        this.proposalNotifications.set(proposal.taskId, {
          taskId: proposal.taskId,
          chatId,
          messageId: sent.message_id,
        });
      } catch (err) {
        this.log.error(`[telegram] Failed to send proposal notification to chat ${chatId}: ${err}`);
      }
    }
  }

  /**
   * Update a proposal notification message after approve/reject.
   */
  private updateProposalNotification(taskId: string, status: string): void {
    const notif = this.proposalNotifications.get(taskId);
    if (!notif) return;

    const icon = status === "approved" || status === "completed" ? "✅"
      : status === "rejected" ? "❌"
      : status === "executing" ? "⏳"
      : "·";

    void this.bot.api.editMessageReplyMarkup(notif.chatId, notif.messageId, {
      reply_markup: undefined, // remove buttons
    }).catch((err) => {
      this.log.warn(`[telegram] Failed to remove buttons: ${String(err)}`);
    });

    // We don't edit the message text to avoid race conditions — the button removal is enough.
    // The icon in the callback answer already confirms the action.
  }

  /**
   * Poll the world model for new alert-worthy frames.
   * This avoids race conditions with PiSession's onIngest hook.
   */
  private startAlertPolling(): void {
    // Check every 5 seconds for new frames
    this.alertTimer = setInterval(() => {
      if (this.alertSubscribers.size === 0) return;

      const recentFrames = this.runtime.worldModel.getRecentFrames(20);
      for (const frame of recentFrames) {
        if (this.alertedFrameIds.has(frame.frameId)) continue;
        this.alertedFrameIds.add(frame.frameId);
        this.handleAlertFrame(frame);
      }

      // Prune old frame IDs to prevent unbounded memory growth
      if (this.alertedFrameIds.size > 1000) {
        const arr = [...this.alertedFrameIds];
        this.alertedFrameIds = new Set(arr.slice(-500));
      }
    }, 5000);
  }

  /**
   * Handle alert-worthy observation frames.
   */
  private handleAlertFrame(frame: ContextFrame): void {
    if (frame.kind !== "observation") return;
    if (this.alertSubscribers.size === 0) return;

    const data = frame.data;
    const status = data.status as string | undefined;
    if (!status) return;

    // Filter by severity
    const severityMap: Record<string, number> = { normal: 0, low: 1, critical: 2 };
    const frameSeverity = severityMap[status] ?? 0;
    const minSeverity = severityMap[this.alertMinSeverity] ?? 1;
    if (frameSeverity < minSeverity) return;

    const icon = status === "critical" ? "🚨" : status === "low" ? "⚠️" : "📊";
    const zone = data.zone ?? "unknown";
    const metric = data.metric ?? "unknown";
    const value = data.value;
    const unit = data.unit ?? "";
    const source = frame.sourceDisplayName ?? frame.sourceDeviceId.slice(0, 12);

    const text = `${icon} *Alert:* ${zone} ${metric} = ${value}${unit} (${status})\nSource: ${source}`;

    for (const chatId of this.alertSubscribers) {
      void this.bot.api.sendMessage(chatId, text, { parse_mode: "Markdown" }).catch((err) => {
        this.log.error(`[telegram] Failed to send alert to chat ${chatId}: ${err}`);
      });
    }
  }

  // ─── Helpers ────────────────────────────────────────────

  private getOrCreateConversation(chatId: number): TelegramConversation {
    let conv = this.conversations.get(chatId);
    if (!conv) {
      conv = {
        chatId,
        conversationId: `tg-${chatId}-${randomUUID().slice(0, 8)}`,
        lastActivity: Date.now(),
      };
      this.conversations.set(chatId, conv);
      this.conversationToChatId.set(conv.conversationId, chatId);
    }
    conv.lastActivity = Date.now();
    return conv;
  }

  /**
   * Escape special characters for MarkdownV2.
   */
  private escMd(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
  }

  /**
   * Chunk a message into parts that fit Telegram's 4096 char limit.
   */
  private chunkMessage(text: string, limit: number): string[] {
    if (text.length <= limit) return [text];

    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= limit) {
        chunks.push(remaining);
        break;
      }
      // Try to break at a newline near the limit
      let breakPoint = remaining.lastIndexOf("\n", limit);
      if (breakPoint < limit * 0.5) breakPoint = limit; // No good newline, hard break
      chunks.push(remaining.slice(0, breakPoint));
      remaining = remaining.slice(breakPoint).trimStart();
    }
    return chunks;
  }
}
