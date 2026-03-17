/**
 * Architecture invariant tests — validate structural properties
 * that must hold across the entire codebase after all extractions.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function findFiles(dir: string, pattern: RegExp): string[] {
  const results: string[] = [];
  function walk(d: string) {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) {
        if (!entry.startsWith(".") && entry !== "node_modules") walk(full);
      } else if (pattern.test(entry)) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

const srcDir = join(process.cwd(), "src");

// ─── Module inventory ───────────────────────────────

describe("Architecture - module inventory", () => {
  const sourceFiles = findFiles(srcDir, /\.ts$/).filter(f => !f.includes(".test."));
  const testFiles = findFiles(srcDir, /\.test\.ts$/);

  it("has at least 65 source modules", () => {
    expect(sourceFiles.length).toBeGreaterThanOrEqual(65);
  });

  it("has at least 80 test files", () => {
    expect(testFiles.length).toBeGreaterThanOrEqual(80);
  });

  it("test-to-source ratio above 1.0", () => {
    const ratio = testFiles.length / sourceFiles.length;
    expect(ratio).toBeGreaterThan(1.0);
  });
});

// ─── God object health ──────────────────────────────

describe("Architecture - god object health", () => {
  it("node-runtime.ts is under 500 lines", () => {
    const content = readFileSync(join(srcDir, "mesh/node-runtime.ts"), "utf8");
    const lines = content.split("\n").length;
    expect(lines).toBeLessThan(500);
  });

  it("pi-session.ts is under 1000 lines", () => {
    const content = readFileSync(join(srcDir, "agents/pi-session.ts"), "utf8");
    const lines = content.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });
});

// ─── Extracted module existence ─────────────────────

describe("Architecture - extracted modules exist", () => {
  const expectedModules = [
    "mesh/event-bus.ts",
    "mesh/rpc-dispatcher.ts",
    "mesh/intent-router.ts",
    "mesh/ui-broadcaster.ts",
    "mesh/transport.ts",
    "mesh/context-sync.ts",
    "mesh/message-router.ts",
    "mesh/actuation-sender.ts",
    "mesh/peer-connection-manager.ts",
    "mesh/capability-router.ts",
    "mesh/capability-types.ts",
    "mesh/auto-connect.ts",
    "mesh/trust-audit.ts",
    "mesh/health-check.ts",
    "mesh/sensor-simulation.ts",
    "mesh/actuator-logic.ts",
    "agents/threshold-checker.ts",
    "agents/system-prompt-builder.ts",
    "agents/trigger-queue.ts",
    "agents/mode-controller.ts",
    "agents/planner-prompt-builder.ts",
    "agents/session-event-classifier.ts",
    "agents/proposal-manager.ts",
    "agents/frame-ingestor.ts",
    "agents/pattern-logic.ts",
    "agents/extensions/mesh-extension-helpers.ts",
    "channels/telegram-helpers.ts",
    "cli/cli-utils.ts",
    "cli/cli-config.ts",
    "infra/mesh-logger.ts",
    "mesh/chat-handlers.ts",
    "mesh/inbound-connection.ts",
    "agents/pi-session-config.ts",
  ];

  for (const mod of expectedModules) {
    it(`${mod} exists`, () => {
      const fullPath = join(srcDir, mod);
      expect(statSync(fullPath).isFile()).toBe(true);
    });
  }
});

// ─── Test coverage completeness ─────────────────────

describe("Architecture - test coverage", () => {
  const testableModules = [
    "mesh/event-bus",
    "mesh/rpc-dispatcher",
    "mesh/transport",
    "mesh/context-sync",
    "mesh/message-router",
    "mesh/capabilities",
    "mesh/capability-types",
    "mesh/capability-router",
    "mesh/auto-connect",
    "mesh/trust-audit",
    "mesh/health-check",
    "mesh/world-model",
    "mesh/peer-registry",
    "mesh/actuation-sender",
    "mesh/peer-connection-manager",
    "agents/threshold-checker",
    "agents/trigger-queue",
    "agents/pattern-memory",
    "agents/mode-controller",
    "agents/planner-prompt-builder",
    "agents/session-event-classifier",
    "agents/proposal-manager",
    "agents/frame-ingestor",
    "agents/pattern-logic",
    "agents/extensions/mesh-extension-helpers",
    "cli/cli-utils",
    "cli/cli-config",
    "infra/mesh-logger",
    "infra/credential-store",
    "infra/device-identity",
    "mesh/chat-handlers",
    "mesh/inbound-connection",
    "mesh/sensor-simulation",
    "mesh/actuator-logic",
    "agents/pi-session-config",
  ];

  for (const mod of testableModules) {
    it(`${mod} has a test file`, () => {
      const testPath = join(srcDir, `${mod}.test.ts`);
      expect(statSync(testPath).isFile()).toBe(true);
    });
  }
});

// ─── No circular dependencies (basic check) ─────────

describe("Architecture - no obvious circular imports", () => {
  it("actuator-logic has no mesh-runtime imports", () => {
    const content = readFileSync(join(srcDir, "mesh/actuator-logic.ts"), "utf8");
    expect(content).not.toContain("node-runtime");
  });

  it("sensor-simulation has no mesh-runtime imports", () => {
    const content = readFileSync(join(srcDir, "mesh/sensor-simulation.ts"), "utf8");
    expect(content).not.toContain("node-runtime");
  });

  it("mode-controller has no pi-session imports", () => {
    const content = readFileSync(join(srcDir, "agents/mode-controller.ts"), "utf8");
    expect(content).not.toContain("pi-session");
  });

  it("proposal-manager has no pi-session imports", () => {
    const content = readFileSync(join(srcDir, "agents/proposal-manager.ts"), "utf8");
    expect(content).not.toContain("pi-session");
  });

  it("frame-ingestor has no pi-session imports", () => {
    const content = readFileSync(join(srcDir, "agents/frame-ingestor.ts"), "utf8");
    expect(content).not.toContain("pi-session");
  });
});
