/**
 * MeshLogger — structured logging with correlation IDs.
 *
 * Replaces the ad-hoc { info, warn, error } logger interface with
 * structured JSON output that can be aggregated and searched.
 *
 * Features:
 *   - Structured JSON output per log line
 *   - Log levels: debug, info, warn, error
 *   - Correlation ID per peer/session/request
 *   - Component tagging (mesh, planner, telegram, etc.)
 *   - Compatible with existing { info, warn, error } interface
 *   - Configurable output (JSON or human-readable)
 */

// ─── Types ──────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  correlationId?: string;
  deviceId?: string;
  data?: Record<string, unknown>;
};

export type LogOutput = "json" | "human";

export type MeshLoggerOptions = {
  /** Component name (e.g. "mesh", "planner", "telegram"). */
  component: string;
  /** Minimum log level. Default: "info". */
  minLevel?: LogLevel;
  /** Output format. Default: "human". */
  output?: LogOutput;
  /** Default correlation ID (e.g. deviceId). */
  correlationId?: string;
  /** Device ID for log attribution. */
  deviceId?: string;
  /** Custom writer function (default: console). */
  writer?: (line: string) => void;
};

// ─── Level ordering ─────────────────────────────────────────

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ─── MeshLogger ─────────────────────────────────────────────

export class MeshLogger {
  private readonly component: string;
  private readonly minLevel: number;
  private readonly outputFormat: LogOutput;
  private readonly correlationId?: string;
  private readonly deviceId?: string;
  private readonly writer: (line: string) => void;

  constructor(opts: MeshLoggerOptions) {
    this.component = opts.component;
    this.minLevel = LEVEL_ORDER[opts.minLevel ?? "info"];
    this.outputFormat = opts.output ?? "human";
    this.correlationId = opts.correlationId;
    this.deviceId = opts.deviceId;
    this.writer = opts.writer ?? ((line) => console.log(line));
  }

  /**
   * Create a child logger with additional context.
   */
  child(opts: {
    component?: string;
    correlationId?: string;
    deviceId?: string;
  }): MeshLogger {
    return new MeshLogger({
      component: opts.component ?? this.component,
      minLevel: Object.entries(LEVEL_ORDER).find(
        ([, v]) => v === this.minLevel,
      )?.[0] as LogLevel ?? "info",
      output: this.outputFormat,
      correlationId: opts.correlationId ?? this.correlationId,
      deviceId: opts.deviceId ?? this.deviceId,
      writer: this.writer,
    });
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log("error", message, data);
  }

  /**
   * Get a legacy-compatible logger interface { info, warn, error }.
   * Use this to bridge with existing code that expects the old interface.
   */
  toLegacy(): { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void } {
    return {
      info: (msg: string) => this.info(msg),
      warn: (msg: string) => this.warn(msg),
      error: (msg: string) => this.error(msg),
    };
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      correlationId: this.correlationId,
      deviceId: this.deviceId,
      data,
    };

    if (this.outputFormat === "json") {
      this.writer(JSON.stringify(entry));
    } else {
      this.writer(this.formatHuman(entry));
    }
  }

  private formatHuman(entry: LogEntry): string {
    const time = entry.timestamp.slice(11, 23); // HH:MM:SS.mmm
    const level = entry.level.toUpperCase().padEnd(5);
    const comp = `[${entry.component}]`;
    const corr = entry.correlationId ? ` (${entry.correlationId.slice(0, 12)})` : "";
    const data = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
    return `${time} ${level} ${comp}${corr} ${entry.message}${data}`;
  }
}

/**
 * Convenience: create a JSON-mode logger.
 */
export function createStructuredLogger(opts: Omit<MeshLoggerOptions, "output">): MeshLogger {
  return new MeshLogger({ ...opts, output: "json" });
}
