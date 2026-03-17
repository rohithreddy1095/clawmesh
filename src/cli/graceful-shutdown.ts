/**
 * GracefulShutdown — handles process signals for clean mesh node shutdown.
 *
 * Ensures:
 * - SIGTERM/SIGINT trigger orderly shutdown
 * - Running operations get a chance to complete (with timeout)
 * - Double-signal forces immediate exit
 * - Exit code reflects whether shutdown was clean
 */

export type ShutdownHandler = () => Promise<void> | void;

export type GracefulShutdownConfig = {
  /** Maximum time to wait for shutdown handlers (ms). Default: 10s. */
  timeoutMs?: number;
  /** Logger for shutdown messages. */
  log?: { info: (msg: string) => void; warn: (msg: string) => void };
  /** Called before shutdown starts. */
  onShutdownStart?: () => void;
  /** Called after shutdown completes. */
  onShutdownComplete?: () => void;
  /** Call process.exit after shutdown. Default: true for CLI, false for tests. */
  exitProcess?: boolean;
};

export class GracefulShutdown {
  private handlers: ShutdownHandler[] = [];
  private shuttingDown = false;
  private forceCount = 0;
  private readonly timeoutMs: number;
  private readonly log: { info: (msg: string) => void; warn: (msg: string) => void };
  private readonly config: GracefulShutdownConfig;

  constructor(config: GracefulShutdownConfig = {}) {
    this.config = config;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.log = config.log ?? {
      info: (msg) => console.log(msg),
      warn: (msg) => console.warn(msg),
    };
  }

  /**
   * Register a shutdown handler. Handlers run in order of registration.
   */
  register(handler: ShutdownHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Install signal handlers on the process.
   */
  install(): void {
    const handler = () => this.handleSignal();
    process.on("SIGTERM", handler);
    process.on("SIGINT", handler);
  }

  /**
   * Handle a shutdown signal.
   */
  async handleSignal(): Promise<void> {
    if (this.shuttingDown) {
      this.forceCount++;
      if (this.forceCount >= 2) {
        this.log.warn("mesh: forced exit (third signal)");
        process.exit(1);
      }
      this.log.warn("mesh: shutdown in progress... send again to force exit");
      return;
    }

    this.shuttingDown = true;
    this.config.onShutdownStart?.();
    this.log.info("mesh: shutting down gracefully...");

    const timer = setTimeout(() => {
      this.log.warn(`mesh: shutdown timed out after ${this.timeoutMs}ms, forcing exit`);
      process.exit(1);
    }, this.timeoutMs);
    timer.unref?.();

    try {
      for (const handler of this.handlers) {
        await handler();
      }
      clearTimeout(timer);
      this.log.info("mesh: shutdown complete");
      this.config.onShutdownComplete?.();
      if (this.config.exitProcess !== false) process.exit(0);
    } catch (err) {
      clearTimeout(timer);
      this.log.warn(`mesh: shutdown error: ${String(err)}`);
      if (this.config.exitProcess !== false) process.exit(1);
    }
  }

  /**
   * Check if shutdown is in progress.
   */
  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }
}

/**
 * Create a simple graceful shutdown for a mesh node.
 */
export function createGracefulShutdown(
  stopFn: () => Promise<void>,
  config?: GracefulShutdownConfig,
): GracefulShutdown {
  const shutdown = new GracefulShutdown(config);
  shutdown.register(stopFn);
  shutdown.install();
  return shutdown;
}
