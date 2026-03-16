/**
 * ModeController — manages PiSession operational mode transitions.
 *
 * Extracted from PiSession for testability. Handles:
 * - Mode state machine (active → observing → suspended)
 * - Error tracking and threshold-based transitions
 * - Resume logic with counter reset
 * - Permanent error detection for immediate suspension
 */

export type SessionMode = "active" | "observing" | "suspended";

export interface ModeControllerOptions {
  /** Consecutive errors before entering observing mode (default: 3). */
  errorThreshold?: number;
  /** Cooldown in observing mode before a probe (ms, default: 15 min). */
  observingCooldownMs?: number;
  /** Callback when mode changes. */
  onModeChange?: (mode: SessionMode, reason: string) => void;
  /** Logger. */
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

const noop = () => {};
const defaultLog = { info: noop, warn: noop, error: noop };

export class ModeController {
  private _mode: SessionMode = "active";
  private _consecutiveErrors = 0;
  private _lastErrorTime = 0;
  private _suspendReason = "";
  private readonly errorThreshold: number;
  readonly observingCooldownMs: number;
  private readonly onModeChange?: (mode: SessionMode, reason: string) => void;
  private readonly log: NonNullable<ModeControllerOptions["log"]>;

  constructor(opts: ModeControllerOptions = {}) {
    this.errorThreshold = opts.errorThreshold ?? 3;
    this.observingCooldownMs = opts.observingCooldownMs ?? 15 * 60_000;
    this.onModeChange = opts.onModeChange;
    this.log = opts.log ?? defaultLog;
  }

  get mode(): SessionMode {
    return this._mode;
  }

  get consecutiveErrors(): number {
    return this._consecutiveErrors;
  }

  get lastErrorTime(): number {
    return this._lastErrorTime;
  }

  get suspendReason(): string {
    return this._suspendReason;
  }

  /**
   * Transition to a new mode. Only triggers callback if mode actually changed.
   */
  setMode(newMode: SessionMode, reason: string): boolean {
    const prev = this._mode;
    if (prev === newMode) return false;

    this._mode = newMode;
    this._suspendReason = newMode === "suspended" ? reason : "";

    if (newMode === "active") {
      this.log.info(`[mode-ctrl] MODE: active — ${reason}. LLM calls resumed.`);
    } else if (newMode === "observing") {
      const cooldownMin = Math.round(this.observingCooldownMs / 60_000);
      this.log.warn(
        `[mode-ctrl] MODE: observing — ${reason}. ` +
        `LLM calls paused. Will probe in ${cooldownMin} min.`,
      );
    } else {
      this.log.error(
        `[mode-ctrl] MODE: suspended — ${reason}. ` +
        `All LLM calls stopped. Use 'resume' to re-enable.`,
      );
    }

    this.onModeChange?.(newMode, reason);
    return true;
  }

  /**
   * Record an LLM failure. Returns the resulting mode after processing.
   *
   * - permanent errors → immediate suspend
   * - consecutiveErrors >= threshold → observing
   * - observing + more failures → stays observing (needs probe reschedule)
   */
  recordFailure(reason: string, permanent: boolean): SessionMode {
    this._consecutiveErrors++;
    this._lastErrorTime = Date.now();

    if (permanent) {
      this.setMode("suspended", reason);
      return this._mode;
    }

    if (this._mode === "active" && this._consecutiveErrors >= this.errorThreshold) {
      this.setMode("observing", `${this._consecutiveErrors} consecutive errors — ${reason}`);
    } else if (this._mode === "active") {
      this.log.warn(
        `[mode-ctrl] LLM error ${this._consecutiveErrors}/${this.errorThreshold}: ${reason}`,
      );
    }
    // If observing, stay observing (caller should reschedule probe)

    return this._mode;
  }

  /**
   * Record a successful LLM call. Resets error counter and transitions to active.
   */
  recordSuccess(): void {
    this._consecutiveErrors = 0;
    this._lastErrorTime = 0;
    if (this._mode === "observing") {
      this.setMode("active", "LLM call succeeded");
    }
  }

  /**
   * Manually resume from suspended or observing mode.
   */
  resume(reason = "manual resume"): void {
    this._consecutiveErrors = 0;
    this._lastErrorTime = 0;
    this.setMode("active", reason);
  }

  /**
   * Check if the session is in a state that allows LLM calls.
   */
  canMakeLLMCalls(): boolean {
    return this._mode === "active";
  }

  /**
   * Get a summary of the current controller state.
   */
  getStatus(): {
    mode: SessionMode;
    consecutiveErrors: number;
    errorThreshold: number;
    suspendReason: string;
  } {
    return {
      mode: this._mode,
      consecutiveErrors: this._consecutiveErrors,
      errorThreshold: this.errorThreshold,
      suspendReason: this._suspendReason,
    };
  }
}
