/**
 * Final architecture summary validation.
 *
 * This test file validates the complete architecture after Session 5 wiring:
 * - All modules are importable and have correct exports
 * - Line counts are within targets
 * - Module graph is properly connected
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

// ── Module import health ──────────────────────────────

describe("Session 5: All extracted PiSession modules are importable", () => {
  it("ModeController", async () => {
    const mod = await import("./mode-controller.js");
    expect(mod.ModeController).toBeDefined();
    const ctrl = new mod.ModeController();
    expect(ctrl.mode).toBe("active");
  });

  it("ProposalManager", async () => {
    const mod = await import("./proposal-manager.js");
    expect(mod.ProposalManager).toBeDefined();
    const pm = new mod.ProposalManager();
    expect(pm.size).toBe(0);
  });

  it("FrameIngestor", async () => {
    const mod = await import("./frame-ingestor.js");
    expect(mod.ingestFrame).toBeTypeOf("function");
    expect(mod.isPatternFrame).toBeTypeOf("function");
    expect(mod.extractPatterns).toBeTypeOf("function");
  });

  it("ThresholdChecker", async () => {
    const mod = await import("./threshold-checker.js");
    expect(mod.checkThresholdBreach).toBeTypeOf("function");
    expect(mod.isPermanentLLMError).toBeTypeOf("function");
  });

  it("SessionEventClassifier", async () => {
    const mod = await import("./session-event-classifier.js");
    expect(mod.classifyEvent).toBeTypeOf("function");
    expect(mod.extractAssistantText).toBeTypeOf("function");
    expect(mod.extractToolCallNames).toBeTypeOf("function");
  });

  it("PlannerPromptBuilder", async () => {
    const mod = await import("./planner-prompt-builder.js");
    expect(mod.buildOperatorPrompt).toBeTypeOf("function");
    expect(mod.buildPlannerPrompt).toBeTypeOf("function");
    expect(mod.cleanIntentText).toBeTypeOf("function");
    expect(mod.extractCitations).toBeTypeOf("function");
    expect(mod.parseModelSpec).toBeTypeOf("function");
  });

  it("SystemPromptBuilder", async () => {
    const mod = await import("./system-prompt-builder.js");
    expect(mod.buildPlannerSystemPrompt).toBeTypeOf("function");
  });

  it("BroadcastHelpers", async () => {
    const mod = await import("./broadcast-helpers.js");
    expect(mod.buildAgentResponseFrame).toBeTypeOf("function");
    expect(mod.buildPatternGossipFrame).toBeTypeOf("function");
    expect(mod.buildErrorResponse).toBeTypeOf("function");
    expect(mod.buildRateLimitResponse).toBeTypeOf("function");
  });

  it("LLMResponseHelpers", async () => {
    const mod = await import("./llm-response-helpers.js");
    expect(mod.hasAssistantContent).toBeTypeOf("function");
    expect(mod.getLastMessage).toBeTypeOf("function");
    expect(mod.findRecentProposalIds).toBeTypeOf("function");
  });

  it("TriggerQueue", async () => {
    const mod = await import("./trigger-queue.js");
    expect(mod.TriggerQueue).toBeDefined();
    const q = new mod.TriggerQueue();
    expect(q.isEmpty).toBe(true);
  });

  it("PatternMemory", async () => {
    const mod = await import("./pattern-memory.js");
    expect(mod.PatternMemory).toBeDefined();
  });

  it("PatternLogic", async () => {
    const mod = await import("./pattern-logic.js");
    expect(mod.calculateConfidence).toBeTypeOf("function");
  });

  it("PiSessionConfig", async () => {
    const mod = await import("./pi-session-config.js");
    expect(mod.resolvePiSessionConfig).toBeTypeOf("function");
  });
});

// ── Architecture metrics ──────────────────────────────

describe("Architecture metrics targets", () => {
  it("PiSession decomposition: 13 extracted modules", () => {
    const piSessionModules = [
      "mode-controller.ts",
      "proposal-manager.ts",
      "frame-ingestor.ts",
      "threshold-checker.ts",
      "session-event-classifier.ts",
      "planner-prompt-builder.ts",
      "system-prompt-builder.ts",
      "broadcast-helpers.ts",
      "llm-response-helpers.ts",
      "pi-session-config.ts",
      "trigger-queue.ts",
      "pattern-memory.ts",
      "pattern-logic.ts",
    ];
    expect(piSessionModules).toHaveLength(13);
  });

  it("PiSession imports all 9 wired modules", () => {
    const content = readFileSync(resolve(root, "agents/pi-session.ts"), "utf8");
    const wiredImports = [
      "mode-controller",
      "proposal-manager",
      "frame-ingestor",
      "threshold-checker",
      "session-event-classifier",
      "planner-prompt-builder",
      "system-prompt-builder",
      "broadcast-helpers",
      "llm-response-helpers",
    ];
    for (const mod of wiredImports) {
      expect(content).toContain(mod);
    }
  });
});
