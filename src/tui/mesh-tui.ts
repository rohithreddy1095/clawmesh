/**
 * ClawMesh Terminal UI — persistent live dashboard for mesh state.
 *
 * Renders a two-column layout (peers + gossip) with proposals, world model,
 * status bar, and operator command input. Polls the MeshNodeRuntime on a
 * 500ms timer — no event hooks needed, no callback conflicts with PiSession.
 *
 * Usage:
 *   const tui = new MeshTUI({ runtime });
 *   tui.start();  // enters alt screen, captures console output
 *   tui.stop();   // restores terminal
 */

import {
  ALT_ON, ALT_OFF, CUR_HIDE, CUR_SHOW, HOME,
  RST, BOLD,
  C, B,
  fit, pad, dw,
} from "./ansi.js";
import type { MeshNodeRuntime } from "../mesh/node-runtime.js";
import type { ContextFrame } from "../mesh/context-types.js";

// ─── Types ────────────────────────────────────────────────

export type MeshTUIOptions = {
  runtime: MeshNodeRuntime;
  /** Render interval in milliseconds. Default: 500. */
  refreshMs?: number;
};

// ─── MeshTUI ──────────────────────────────────────────────

export class MeshTUI {
  private rt: MeshNodeRuntime;
  private W = 80;
  private H = 24;
  private input = "";
  private cursor = 0;
  private t0 = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private refreshMs: number;

  // Flash message (temporary status overlay)
  private flashText: string | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  // Captured system logs
  private logs: Array<{ t: number; lvl: string; msg: string }> = [];

  // Saved console originals for monkey-patching
  private origLog = console.log;
  private origWarn = console.warn;
  private origErr = console.error;

  /**
   * Provide this object as the runtime's `log` option.
   * After TUI.start(), all runtime log calls are captured into the TUI.
   */
  readonly log = {
    info: (msg: string) => this.capture("info", msg),
    warn: (msg: string) => this.capture("warn", msg),
    error: (msg: string) => this.capture("error", msg),
  };

  constructor(opts: MeshTUIOptions) {
    this.rt = opts.runtime;
    this.refreshMs = opts.refreshMs ?? 500;
  }

  // ─── Lifecycle ──────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.t0 = Date.now();
    this.dims();

    // Monkey-patch console to capture ALL stray output
    this.origLog = console.log;
    this.origWarn = console.warn;
    this.origErr = console.error;
    console.log = (...a: unknown[]) => this.capture("info", a.map(String).join(" "));
    console.warn = (...a: unknown[]) => this.capture("warn", a.map(String).join(" "));
    console.error = (...a: unknown[]) => this.capture("error", a.map(String).join(" "));

    // Enter alternate screen
    process.stdout.write(ALT_ON + CUR_HIDE);

    // Raw mode for keyboard input
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", this.onKey);
    process.stdout.on("resize", this.onResize);

    // Start render loop
    this.render();
    this.timer = setInterval(() => this.render(), this.refreshMs);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.flashTimer) { clearTimeout(this.flashTimer); this.flashTimer = null; }

    // Unhook events
    process.stdout.off("resize", this.onResize);
    process.stdin.off("data", this.onKey);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();

    // Restore terminal
    process.stdout.write(CUR_SHOW + ALT_OFF);

    // Restore console
    console.log = this.origLog;
    console.warn = this.origWarn;
    console.error = this.origErr;

    // Print exit summary
    const up = this.fmtUptime(Date.now() - this.t0);
    const peers = this.rt.peerRegistry.listConnected().length;
    console.log(`\nClawMesh TUI exited. Ran for ${up} with ${peers} peer(s).`);
  }

  // ─── Internals ──────────────────────────────────────────

  private capture(lvl: string, msg: string): void {
    this.logs.push({ t: Date.now(), lvl, msg });
    if (this.logs.length > 500) this.logs = this.logs.slice(-500);
  }

  private flash(msg: string, ms = 4000): void {
    this.flashText = msg;
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.flashText = null;
      this.render();
    }, ms);
    this.render();
  }

  private dims = (): void => {
    this.W = process.stdout.columns || 80;
    this.H = process.stdout.rows || 24;
  };

  private onResize = (): void => {
    this.dims();
    this.render();
  };

  // ─── Keyboard Input ─────────────────────────────────────

  private onKey = (data: Buffer): void => {
    const s = data.toString();
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);

      // Ctrl+C → quit
      if (c === 3) { this.stop(); process.exit(0); return; }

      // Enter → submit command
      if (c === 13) {
        if (this.input.trim()) {
          this.exec(this.input.trim());
          this.input = "";
          this.cursor = 0;
        }
        this.render();
        return;
      }

      // Backspace
      if (c === 127 || c === 8) {
        if (this.cursor > 0) {
          this.input = this.input.slice(0, this.cursor - 1) + this.input.slice(this.cursor);
          this.cursor--;
        }
        this.render();
        return;
      }

      // Escape → clear input (skip arrow key sequences)
      if (c === 27) {
        if (i + 2 < s.length && s[i + 1] === "[") { i += 2; continue; }
        this.input = "";
        this.cursor = 0;
        this.render();
        return;
      }

      // Printable character
      if (c >= 32 && c < 127) {
        this.input = this.input.slice(0, this.cursor) + s[i] + this.input.slice(this.cursor);
        this.cursor++;
        this.render();
        return;
      }
    }
  };

  // ─── Command Dispatch ───────────────────────────────────

  private exec(cmd: string): void {
    const [first, ...args] = cmd.split(/\s+/);
    const lc = first.toLowerCase();

    if (lc === "q" || lc === "quit" || lc === "exit") {
      this.stop();
      process.exit(0);
      return;
    }

    if (lc === "h" || lc === "help") {
      this.flash(
        "a <id>=approve  r <id>=reject  w=world  s=status  resume  q=quit  [text]=send intent",
        6000,
      );
      return;
    }

    if (lc === "a" || lc === "approve") {
      const pi = this.rt.piSession;
      if (!pi) { this.flash("Pi planner not active"); return; }
      const prefix = args[0];
      if (!prefix) { this.flash("Usage: approve <taskId-prefix>"); return; }
      const match = pi.getProposals({ status: "awaiting_approval" })
        .find(p => p.taskId.startsWith(prefix));
      if (!match) { this.flash(`No awaiting proposal matching "${prefix}"`); return; }
      pi.approveProposal(match.taskId, "operator-tui").then(r => {
        this.flash(r ? `✓ Approved [${match.taskId.slice(0, 8)}]` : "Approval failed");
      }).catch(() => this.flash("Approval error"));
      return;
    }

    if (lc === "r" || lc === "reject") {
      const pi = this.rt.piSession;
      if (!pi) { this.flash("Pi planner not active"); return; }
      const prefix = args[0];
      if (!prefix) { this.flash("Usage: reject <taskId-prefix>"); return; }
      const match = pi.getProposals({ status: "awaiting_approval" })
        .find(p => p.taskId.startsWith(prefix));
      if (!match) { this.flash(`No awaiting proposal matching "${prefix}"`); return; }
      const r = pi.rejectProposal(match.taskId, "operator-tui");
      this.flash(r ? `✗ Rejected [${match.taskId.slice(0, 8)}]` : "Reject failed");
      return;
    }

    if (lc === "s" || lc === "status" || lc === "mode") {
      const pi = this.rt.piSession;
      if (!pi) { this.flash("Mode: BASIC (no planner)"); return; }
      const pending = pi.getProposals({ status: "awaiting_approval" }).length;
      this.flash(
        `Mode: ${pi.mode.toUpperCase()} | ${pending} awaiting | ${pi.getProposals().length} total proposals`,
      );
      return;
    }

    if (lc === "resume") {
      const pi = this.rt.piSession;
      if (!pi) { this.flash("No planner to resume"); return; }
      if (pi.mode === "active") { this.flash("Already active"); return; }
      pi.resume("manual resume via TUI");
      this.flash("Resumed — LLM calls re-enabled");
      return;
    }

    if (lc === "w" || lc === "world") {
      const entries = this.rt.worldModel.getAll();
      if (entries.length === 0) { this.flash("World model empty"); return; }
      const parts = entries.slice(0, 5).map(e => {
        const d = e.lastFrame.data;
        return d.zone && d.metric ? `${d.zone}:${d.metric}=${d.value}` : "";
      }).filter(Boolean);
      this.flash(`World: ${parts.join(" | ") || `${entries.length} entries`}`, 6000);
      return;
    }

    if (lc === "logs" || lc === "l") {
      const recent = this.logs.slice(-5);
      if (recent.length === 0) { this.flash("No system logs captured"); return; }
      const summary = recent.map(l => l.msg.slice(0, 60)).join("  ▪  ");
      this.flash(summary, 8000);
      return;
    }

    // Default: send as operator intent to Pi
    const pi = this.rt.piSession;
    if (pi) {
      pi.handleOperatorIntent(cmd);
      this.flash(`→ Sent to planner: "${cmd.slice(0, 50)}"`);
    } else {
      this.flash("No planner active. Use --pi-planner to enable.");
    }
  }

  // ─── RENDERING ──────────────────────────────────────────

  private render(): void {
    if (!this.running) return;
    const W = this.W;
    const H = this.H;
    const iW = W - 2; // inner width (between outer │ borders)

    // Minimum terminal size check
    if (W < 40 || H < 10) {
      process.stdout.write(
        HOME + `${C.orange}${BOLD}ClawMesh${RST} ${C.dim}Terminal too small (${W}×${H}). Need 40×10+${RST}`,
      );
      return;
    }

    // ── Layout helpers ──────────────────────────────────

    /** Full-width bordered line: │ content │ */
    const ln = (content: string): string =>
      `${C.border}${B.v}${RST}${fit(" " + content, iW)}${C.border}${B.v}${RST}`;

    /** Horizontal separator: ├────────┤ */
    const sep = (): string =>
      `${C.border}${B.lt}${B.h.repeat(iW)}${B.rt}${RST}`;

    /** Top border: ┌────────┐ */
    const topBorder = (): string =>
      `${C.border}${B.tl}${B.h.repeat(iW)}${B.tr}${RST}`;

    /** Bottom border: └────────┘ */
    const botBorder = (): string =>
      `${C.border}${B.bl}${B.h.repeat(iW)}${B.br}${RST}`;

    // ── Collect data ────────────────────────────────────

    const addr = this.rt.listenAddress();
    const name = this.rt.displayName ?? "node";
    const peers = this.rt.peerRegistry.listConnected();
    const frames = this.rt.worldModel.getRecentFrames(200);
    const worldEntries = this.rt.worldModel.getAll();
    const pi = this.rt.piSession;
    const proposals = pi ? pi.getProposals() : [];
    const awaiting = proposals.filter(p => p.status === "awaiting_approval").length;

    // ── Calculate section heights ───────────────────────

    // Two-column widths
    const lW = Math.max(16, Math.min(Math.floor(iW * 0.33), 34));
    const rW = iW - lW - 1; // -1 for middle │

    // Proposal lines (0 if none)
    const maxPropRows = Math.min(proposals.length, 4);
    const propLines = proposals.length > 0 ? maxPropRows + 1 : 0; // +1 for section header

    // Chrome budget below the two-column section:
    //   colBottom(1) + [proposals(P) + propSep(1) if P>0] + world(1) + sep(1) + status(1) + sep(1) + input(1) + bot(1)
    const belowCol = 1 + propLines + (propLines > 0 ? 1 : 0) + 1 + 1 + 1 + 1 + 1 + 1;
    const aboveCol = 3; // topBorder(1) + header(1) + colTop(1)
    const colH = Math.max(3, H - aboveCol - belowCol);

    // ── Output buffer ───────────────────────────────────

    const out: string[] = [];

    // ── HEADER ──────────────────────────────────────────

    const meshBadge = peers.length > 0
      ? `${C.green}● ${peers.length} peers${RST}`
      : `${C.dim}○ solo${RST}`;

    out.push(topBorder());
    out.push(ln(
      `${C.orange}${BOLD}ClawMesh${RST}  ${C.vdim}▪${RST}  ` +
      `${C.white}${name}${RST}  ${C.vdim}▪${RST}  ` +
      `${C.dim}ws://${addr.host}:${addr.port}${RST}  ${C.vdim}▪${RST}  ` +
      meshBadge,
    ));

    // ── TWO-COLUMN: PEERS + GOSSIP ──────────────────────

    // Column top separator: ├────┬────┤
    out.push(`${C.border}${B.lt}${B.h.repeat(lW)}${B.tt}${B.h.repeat(rW)}${B.rt}${RST}`);

    // Build left column content (peers)
    const leftContent = this.buildPeersColumn(peers);

    // Build right column content (context gossip)
    const rightContent = this.buildGossipColumn(frames, colH);

    // Merge columns row by row
    for (let i = 0; i < colH; i++) {
      const left = i < leftContent.length ? leftContent[i] : "";
      const right = i < rightContent.length ? rightContent[i] : "";
      out.push(
        `${C.border}${B.v}${RST}${fit(" " + left, lW)}` +
        `${C.border}${B.v}${RST}${fit(" " + right, rW)}` +
        `${C.border}${B.v}${RST}`,
      );
    }

    // Column bottom separator: ├────┴────┤
    out.push(`${C.border}${B.lt}${B.h.repeat(lW)}${B.bt}${B.h.repeat(rW)}${B.rt}${RST}`);

    // ── PROPOSALS ───────────────────────────────────────

    if (propLines > 0) {
      out.push(ln(
        `${C.yellow}${BOLD}PROPOSALS${RST}` +
        (awaiting > 0
          ? ` ${C.red}(${awaiting} awaiting)${RST}`
          : ` ${C.dim}(${proposals.length})${RST}`),
      ));
      for (const p of proposals.slice(-maxPropRows)) {
        const icon =
          p.status === "awaiting_approval" ? `${C.red}⚠${RST}` :
          p.status === "approved" || p.status === "completed" ? `${C.green}✓${RST}` :
          p.status === "rejected" ? `${C.dim}✗${RST}` :
          p.status === "executing" ? `${C.orange}⟳${RST}` :
          `${C.dim}·${RST}`;
        const sc =
          p.status === "awaiting_approval" ? C.red :
          p.status === "approved" || p.status === "completed" ? C.green :
          C.dim;
        out.push(ln(
          `${icon} ${C.dim}[${p.taskId.slice(0, 8)}]${RST} ` +
          `${sc}${p.approvalLevel} ${p.status.toUpperCase()}${RST}  ` +
          `${C.white}${p.summary}${RST}`,
        ));
      }
      out.push(sep());
    }

    // ── WORLD MODEL ─────────────────────────────────────

    if (worldEntries.length > 0) {
      const parts: string[] = [];
      for (const e of worldEntries.slice(0, 5)) {
        const d = e.lastFrame.data;
        if (d.zone && d.metric && d.value !== undefined) {
          const status = d.status ? ` ${C.dim}(${d.status})${RST}` : "";
          parts.push(`${C.cyan}${d.zone}:${d.metric}${RST} ${C.white}${d.value}${d.unit ?? ""}${status}`);
        }
      }
      const summary = parts.length > 0
        ? parts.join(`  ${C.vdim}▪${RST}  `)
        : `${C.dim}${worldEntries.length} entries${RST}`;
      out.push(ln(`${C.dim}${BOLD}WORLD${RST}  ${summary}`));
    } else {
      out.push(ln(`${C.dim}${BOLD}WORLD${RST}  ${C.dim}(waiting for observations)${RST}`));
    }

    // ── STATUS BAR ──────────────────────────────────────

    out.push(sep());

    if (this.flashText) {
      out.push(ln(`${C.yellow}${this.flashText}${RST}`));
    } else {
      const mode = pi ? pi.mode.toUpperCase() : "BASIC";
      const mc =
        mode === "ACTIVE" ? C.green :
        mode === "OBSERVING" ? C.yellow :
        mode === "SUSPENDED" ? C.red :
        C.dim;
      const up = this.fmtUptime(Date.now() - this.t0);
      out.push(ln(
        `${mc}${mode}${RST}  ${C.vdim}▪${RST}  ` +
        `${C.white}${peers.length} peers${RST}  ${C.vdim}▪${RST}  ` +
        `${C.white}${frames.length} frames${RST}  ${C.vdim}▪${RST}  ` +
        `${C.dim}${up}${RST}` +
        `    ${C.vdim}[h]elp [q]uit${RST}`,
      ));
    }

    // ── INPUT LINE ──────────────────────────────────────

    out.push(sep());

    const prompt = `${C.orange}❯${RST} `;
    const maxInputW = iW - 5; // account for prompt + padding + cursor
    const inputText = this.input
      ? this.input.slice(0, maxInputW) + `${C.orange}█${RST}`
      : `${C.vdim}type command or intent…${RST}`;
    out.push(ln(`${prompt}${inputText}`));

    out.push(botBorder());

    // ── Pad to fill screen & flush ──────────────────────

    while (out.length < H) out.push("");
    process.stdout.write(HOME + out.slice(0, H).join("\n"));
  }

  // ─── Section Builders ─────────────────────────────────

  private buildPeersColumn(peers: ReturnType<typeof this.rt.peerRegistry.listConnected>): string[] {
    const lines: string[] = [];
    lines.push(`${C.orange}${BOLD}PEERS${RST} ${C.dim}(${peers.length})${RST}`);

    if (peers.length === 0) {
      lines.push(`${C.dim}  (waiting for peers…)${RST}`);
      lines.push("");
      lines.push(`${C.vdim}  Connect with:${RST}`);
      lines.push(`${C.vdim}  --peer <id>=<url>${RST}`);
    } else {
      for (const p of peers) {
        const peerName = p.displayName ?? p.deviceId.slice(0, 12);
        lines.push(`${C.green}●${RST} ${C.white}${peerName}${RST}`);
        if (p.capabilities.length > 0) {
          const caps = p.capabilities.slice(0, 3).join(", ");
          const more = p.capabilities.length > 3 ? ` +${p.capabilities.length - 3}` : "";
          lines.push(`  ${C.dim}${caps}${more}${RST}`);
        }
      }
    }

    // Local capabilities
    const localCaps = this.rt.getAdvertisedCapabilities();
    if (localCaps.length > 0) {
      lines.push("");
      lines.push(`${C.vdim}LOCAL CAPS${RST}`);
      lines.push(`${C.dim}  ${localCaps.join(", ")}${RST}`);
    }

    return lines;
  }

  private buildGossipColumn(frames: ContextFrame[], maxRows: number): string[] {
    const lines: string[] = [];
    lines.push(`${C.cyan}${BOLD}GOSSIP${RST} ${C.dim}(${frames.length} frames)${RST}`);

    if (frames.length === 0) {
      lines.push(`${C.dim}  (waiting for context…)${RST}`);
      return lines;
    }

    const kindColor: Record<string, string> = {
      observation: C.cyan,
      event: C.green,
      human_input: C.yellow,
      inference: C.orange,
      capability_update: C.dim,
    };
    const kindShort: Record<string, string> = {
      observation: "obs",
      event: "evt",
      human_input: "inp",
      inference: "inf",
      capability_update: "cap",
    };

    // Show most recent frames (newest first)
    const displayCount = Math.max(1, maxRows - 1); // -1 for header
    const recent = frames.slice(-displayCount).reverse();

    for (const f of recent) {
      const time = new Date(f.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const kc = kindColor[f.kind] ?? C.dim;
      const ks = kindShort[f.kind] ?? f.kind.slice(0, 3);

      // Compact data summary
      const d = f.data;
      let dataSummary: string;
      if (d.zone && d.metric && d.value !== undefined) {
        dataSummary = `${d.zone} ${d.metric}=${d.value}${d.unit ?? ""}`;
      } else if (d.intent) {
        dataSummary = String(d.intent).slice(0, 30);
      } else if (d.decision) {
        dataSummary = String(d.decision).slice(0, 30);
      } else if (d.reasoning) {
        dataSummary = String(d.reasoning).slice(0, 30);
      } else {
        const json = JSON.stringify(d);
        dataSummary = json.length > 32 ? json.slice(0, 30) + "…" : json;
      }

      lines.push(
        `${C.dim}${time}${RST} ${kc}${ks}${RST} ${C.white}${dataSummary}${RST}`,
      );
    }

    return lines;
  }

  // ─── Helpers ──────────────────────────────────────────

  private fmtUptime(ms: number): string {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
    return `${m}m${String(sec).padStart(2, "0")}s`;
  }
}
