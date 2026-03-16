/**
 * Architecture metrics tests — validate the structural health of the codebase.
 *
 * These tests enforce architectural invariants:
 *   - God object stays decomposed
 *   - All extracted modules exist and are imported
 *   - Module count stays above minimum
 *   - Test coverage doesn't regress
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = "src";

function countFiles(dir: string, pattern: RegExp): number {
  let count = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(fullPath, pattern);
    } else if (pattern.test(entry.name)) {
      count++;
    }
  }
  return count;
}

function fileLineCount(path: string): number {
  return readFileSync(path, "utf-8").split("\n").length;
}

describe("Architecture Metrics", () => {
  // ─── God Object Decomposition ──────────────

  it("node-runtime.ts is under 650 lines (decomposed from 754)", () => {
    const lines = fileLineCount("src/mesh/node-runtime.ts");
    expect(lines).toBeLessThan(650);
  });

  it("node-runtime.ts delegates to RpcDispatcher (no inline dispatch)", () => {
    const content = readFileSync("src/mesh/node-runtime.ts", "utf-8");
    expect(content).toContain("rpcDispatcher");
    expect(content).not.toContain("private readonly handlers:");
    expect(content).not.toContain("private async dispatchRpcRequest");
  });

  it("node-runtime.ts delegates to UIBroadcaster (no inline subscribers)", () => {
    const content = readFileSync("src/mesh/node-runtime.ts", "utf-8");
    expect(content).toContain("uiBroadcaster");
    expect(content).not.toContain("private readonly uiSubscribers");
  });

  it("node-runtime.ts delegates to MessageRouter (no inline message handling)", () => {
    const content = readFileSync("src/mesh/node-runtime.ts", "utf-8");
    expect(content).toContain("routeInboundMessage");
  });

  it("node-runtime.ts delegates to IntentRouter (no inline intent logic)", () => {
    const content = readFileSync("src/mesh/node-runtime.ts", "utf-8");
    // The intent routing should be in the MessageRouter delegation, not inline
    expect(content).not.toContain("operation?.name === \"intent:parse\"");
  });

  // ─── Extracted Modules Exist ───────────────

  it("all extracted modules exist", () => {
    const expectedModules = [
      "src/mesh/event-bus.ts",
      "src/mesh/transport.ts",
      "src/mesh/rpc-dispatcher.ts",
      "src/mesh/context-sync.ts",
      "src/mesh/intent-router.ts",
      "src/mesh/ui-broadcaster.ts",
      "src/mesh/health-check.ts",
      "src/mesh/auto-connect.ts",
      "src/mesh/trust-audit.ts",
      "src/mesh/message-router.ts",
      "src/mesh/capability-types.ts",
      "src/mesh/capability-router.ts",
      "src/infra/mesh-logger.ts",
      "src/agents/trigger-queue.ts",
    ];

    for (const mod of expectedModules) {
      expect(existsSync(mod), `Module ${mod} should exist`).toBe(true);
    }
  });

  it("all extracted modules have test files", () => {
    const expectedTests = [
      "src/mesh/event-bus.test.ts",
      "src/mesh/transport.test.ts",
      "src/mesh/rpc-dispatcher.test.ts",
      "src/mesh/context-sync.test.ts",
      "src/mesh/intent-router.test.ts",
      "src/mesh/ui-broadcaster.test.ts",
      "src/mesh/health-check.test.ts",
      "src/mesh/auto-connect.test.ts",
      "src/mesh/trust-audit.test.ts",
      "src/mesh/message-router.test.ts",
      "src/mesh/capability-types.test.ts",
      "src/mesh/capability-router.test.ts",
      "src/infra/mesh-logger.test.ts",
      "src/agents/trigger-queue.test.ts",
    ];

    for (const test of expectedTests) {
      expect(existsSync(test), `Test file ${test} should exist`).toBe(true);
    }
  });

  // ─── Module Counts ─────────────────────────

  it("has at least 50 source modules (up from 38 baseline)", () => {
    const count = countFiles(SRC_DIR, /\.ts$/);
    const testCount = countFiles(SRC_DIR, /\.test\.ts$/);
    const sourceCount = count - testCount;
    expect(sourceCount).toBeGreaterThanOrEqual(50);
  });

  it("has at least 50 test files (up from 17 baseline)", () => {
    const testCount = countFiles(SRC_DIR, /\.test\.ts$/);
    expect(testCount).toBeGreaterThanOrEqual(50);
  });

  // ─── PiSession uses TriggerQueue ───────────

  it("pi-session.ts uses TriggerQueue instead of raw array", () => {
    const content = readFileSync("src/agents/pi-session.ts", "utf-8");
    expect(content).toContain("TriggerQueue");
    expect(content).toContain("triggerQueue");
    expect(content).not.toContain("pendingTriggers");
  });

  // ─── World Model has intelligence methods ──

  it("world-model.ts exports scoreFrameRelevance", () => {
    const content = readFileSync("src/mesh/world-model.ts", "utf-8");
    expect(content).toContain("export function scoreFrameRelevance");
    expect(content).toContain("getRelevantFrames");
    expect(content).toContain("evictStale");
    expect(content).toContain("summarize");
  });

  // ─── PatternMemory has CRDT + decay ────────

  it("pattern-memory.ts has CRDT merge and decay", () => {
    const content = readFileSync("src/agents/pattern-memory.ts", "utf-8");
    expect(content).toContain("sourceCounters");
    expect(content).toContain("mergeSourceCounters");
    expect(content).toContain("decayPatterns");
  });
});
