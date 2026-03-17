/**
 * CLI startup integration tests — validates startup validation + graceful shutdown wiring.
 */

import { describe, it, expect } from "vitest";
import { validateStartupConfig, hasBlockingDiagnostics, formatDiagnostics } from "./startup-validation.js";
import { GracefulShutdown } from "./graceful-shutdown.js";

describe("CLI start: startup validation integration", () => {
  it("typical field-node config passes pre-flight", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "jetson-01-abcdef123456",
      port: 18789,
      capabilities: ["sensor:moisture:zone-1", "sensor:temp:zone-1", "actuator:pump:P1"],
      staticPeers: [
        { deviceId: "hub-device-abc", url: "ws://192.168.1.100:18789" },
      ],
    });
    expect(hasBlockingDiagnostics(diagnostics)).toBe(false);
  });

  it("typical command-center config passes pre-flight", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "hub-device-abc123456789",
      port: 18789,
      capabilities: ["channel:telegram"],
      enablePiSession: true,
      hasApiKey: true,
      modelSpec: "google/gemini-3.1-pro-preview",
    });
    expect(hasBlockingDiagnostics(diagnostics)).toBe(false);
  });

  it("command-center without API key warns", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "hub-device-abc",
      enablePiSession: true,
      hasApiKey: false,
      modelSpec: "anthropic/claude-sonnet-4-5-20250929",
    });
    expect(diagnostics.some(d => d.code === "NO_API_KEY")).toBe(true);
    // Warning, not blocking
    expect(hasBlockingDiagnostics(diagnostics)).toBe(false);
  });
});

describe("CLI start: graceful shutdown integration", () => {
  it("shutdown runs cleanup handlers before exit", async () => {
    const cleaned: string[] = [];
    const shutdown = new GracefulShutdown({
      exitProcess: false,
      log: { info: () => {}, warn: () => {} },
    });

    // Simulate what CLI start command registers
    shutdown.register(async () => { cleaned.push("tui"); });
    shutdown.register(async () => { cleaned.push("telegram"); });
    shutdown.register(async () => { cleaned.push("runtime"); });

    await shutdown.handleSignal();
    expect(cleaned).toEqual(["tui", "telegram", "runtime"]);
    expect(shutdown.isShuttingDown).toBe(true);
  });

  it("double SIGINT warns but does not re-run handlers", async () => {
    const warns: string[] = [];
    const runs: string[] = [];
    const shutdown = new GracefulShutdown({
      exitProcess: false,
      log: { info: () => {}, warn: (m) => warns.push(m) },
    });
    shutdown.register(async () => { runs.push("once"); });

    await shutdown.handleSignal();
    await shutdown.handleSignal();

    expect(runs).toHaveLength(1);
    expect(warns.some(w => w.includes("in progress"))).toBe(true);
  });
});
