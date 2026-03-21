/**
 * Tests for GracefulShutdown — signal handling and cleanup.
 */

import { describe, it, expect } from "vitest";
import { GracefulShutdown } from "./graceful-shutdown.js";

describe("GracefulShutdown", () => {
  it("runs registered handlers in order", async () => {
    const order: number[] = [];
    const shutdown = new GracefulShutdown({ log: { info: () => {}, warn: () => {} }, exitProcess: false });

    shutdown.register(() => { order.push(1); });
    shutdown.register(() => { order.push(2); });
    shutdown.register(() => { order.push(3); });

    await shutdown.handleSignal();
    expect(order).toEqual([1, 2, 3]);
  });

  it("sets isShuttingDown during shutdown", async () => {
    const shutdown = new GracefulShutdown({ log: { info: () => {}, warn: () => {} }, exitProcess: false });
    expect(shutdown.isShuttingDown).toBe(false);
    await shutdown.handleSignal();
    expect(shutdown.isShuttingDown).toBe(true);
  });

  it("second signal warns but doesn't re-run handlers", async () => {
    const warnings: string[] = [];
    const runs: number[] = [];
    const shutdown = new GracefulShutdown({ exitProcess: false,
      log: { info: () => {}, warn: (msg) => warnings.push(msg) },
    });

    shutdown.register(() => { runs.push(1); });

    await shutdown.handleSignal();
    await shutdown.handleSignal(); // Second signal

    expect(runs).toHaveLength(1); // Handlers only run once
    expect(warnings.some(w => w.includes("in progress"))).toBe(true);
  });

  it("calls onShutdownStart and onShutdownComplete", async () => {
    const events: string[] = [];
    const shutdown = new GracefulShutdown({ exitProcess: false,
      log: { info: () => {}, warn: () => {} },
      onShutdownStart: () => events.push("start"),
      onShutdownComplete: () => events.push("complete"),
    });

    await shutdown.handleSignal();
    expect(events).toEqual(["start", "complete"]);
  });

  it("handles async shutdown handlers", async () => {
    const shutdown = new GracefulShutdown({ log: { info: () => {}, warn: () => {} }, exitProcess: false });
    let cleaned = false;

    shutdown.register(async () => {
      await new Promise(r => setTimeout(r, 10));
      cleaned = true;
    });

    await shutdown.handleSignal();
    expect(cleaned).toBe(true);
  });

  it("handles errors in shutdown handlers gracefully", async () => {
    const warnings: string[] = [];
    const shutdown = new GracefulShutdown({ exitProcess: false,
      log: { info: () => {}, warn: (msg) => warnings.push(msg) },
    });

    shutdown.register(() => { throw new Error("cleanup failed"); });

    await shutdown.handleSignal();
    expect(warnings.some(w => w.includes("cleanup failed"))).toBe(true);
  });

  it("empty handlers list shuts down immediately", async () => {
    const events: string[] = [];
    const shutdown = new GracefulShutdown({ exitProcess: false,
      log: { info: () => {}, warn: () => {} },
      onShutdownComplete: () => events.push("done"),
    });

    await shutdown.handleSignal();
    expect(events).toContain("done");
  });

  it("configurable timeout", () => {
    const shutdown = new GracefulShutdown({ timeoutMs: 5000, exitProcess: false });
    // Just verify it doesn't throw
    expect(shutdown.isShuttingDown).toBe(false);
  });
});
