/**
 * Architecture decomposition validation tests — Session 5: PiSession wiring.
 *
 * Validates that PiSession correctly delegates to extracted modules and
 * that the decomposition maintains structural integrity.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");

describe("PiSession decomposition metrics", () => {
  it("PiSession is under 700 lines (was 895)", () => {
    const lines = readFileSync(resolve(root, "src/agents/pi-session.ts"), "utf8").split("\n").length;
    expect(lines).toBeLessThan(700);
  });

  it("node-runtime.ts (god object) is under 510 lines (was 754)", () => {
    const lines = readFileSync(resolve(root, "src/mesh/node-runtime.ts"), "utf8").split("\n").length;
    expect(lines).toBeLessThan(510);
  });
});

describe("PiSession extracted module existence", () => {
  const modules = [
    "src/agents/mode-controller.ts",
    "src/agents/proposal-manager.ts",
    "src/agents/frame-ingestor.ts",
    "src/agents/threshold-checker.ts",
    "src/agents/session-event-classifier.ts",
    "src/agents/planner-prompt-builder.ts",
    "src/agents/system-prompt-builder.ts",
    "src/agents/broadcast-helpers.ts",
    "src/agents/llm-response-helpers.ts",
    "src/agents/pi-session-config.ts",
    "src/agents/trigger-queue.ts",
    "src/agents/pattern-memory.ts",
    "src/agents/pattern-logic.ts",
  ];

  for (const mod of modules) {
    it(`${mod} exists`, () => {
      expect(existsSync(resolve(root, mod))).toBe(true);
    });
  }
});

describe("PiSession extracted module test coverage", () => {
  const modules = [
    "src/agents/mode-controller",
    "src/agents/proposal-manager",
    "src/agents/frame-ingestor",
    "src/agents/threshold-checker",
    "src/agents/session-event-classifier",
    "src/agents/planner-prompt-builder",
    "src/agents/system-prompt-builder",
    "src/agents/broadcast-helpers",
    "src/agents/llm-response-helpers",
    "src/agents/pi-session-config",
    "src/agents/trigger-queue",
    "src/agents/pattern-memory",
    "src/agents/pattern-logic",
  ];

  for (const mod of modules) {
    it(`${mod} has test file`, () => {
      const base = mod.split("/").pop()!;
      const dir = mod.substring(0, mod.lastIndexOf("/"));
      // Check for direct test file or wiring test
      const hasTest = existsSync(resolve(root, `${mod}.test.ts`)) ||
        existsSync(resolve(root, `${dir}/pi-session-module-wiring.test.ts`)) ||
        existsSync(resolve(root, `${dir}/pi-session-event-prompt-wiring.test.ts`)) ||
        existsSync(resolve(root, `${dir}/pi-session-broadcast-wiring.test.ts`));
      expect(hasTest).toBe(true);
    });
  }
});

describe("PiSession imports extracted modules", () => {
  const piSessionContent = readFileSync(resolve(root, "src/agents/pi-session.ts"), "utf8");

  it("imports ModeController", () => {
    expect(piSessionContent).toContain("ModeController");
  });

  it("imports ProposalManager", () => {
    expect(piSessionContent).toContain("ProposalManager");
  });

  it("imports ingestFrame/isPatternFrame", () => {
    expect(piSessionContent).toContain("ingestFrame");
    expect(piSessionContent).toContain("isPatternFrame");
  });

  it("imports classifyEvent", () => {
    expect(piSessionContent).toContain("classifyEvent");
  });

  it("imports buildOperatorPrompt/buildPlannerPrompt", () => {
    expect(piSessionContent).toContain("buildOperatorPrompt");
    expect(piSessionContent).toContain("buildPlannerPrompt");
  });

  it("imports buildPlannerSystemPrompt", () => {
    expect(piSessionContent).toContain("buildPlannerSystemPrompt");
  });

  it("imports buildAgentResponseFrame", () => {
    expect(piSessionContent).toContain("buildAgentResponseFrame");
  });

  it("imports hasAssistantContent", () => {
    expect(piSessionContent).toContain("hasAssistantContent");
  });

  it("imports isPermanentLLMError", () => {
    expect(piSessionContent).toContain("isPermanentLLMError");
  });
});

describe("PiSession no longer contains inline implementations", () => {
  const piSessionContent = readFileSync(resolve(root, "src/agents/pi-session.ts"), "utf8");

  it("no inline isPermanentError method", () => {
    expect(piSessionContent).not.toContain("private isPermanentError");
  });

  it("no inline handleLLMFailure method", () => {
    expect(piSessionContent).not.toContain("private handleLLMFailure");
  });

  it("no inline checkThresholdRule method", () => {
    expect(piSessionContent).not.toContain("private checkThresholdRule");
  });

  it("no inline _mode field", () => {
    expect(piSessionContent).not.toContain("private _mode");
  });

  it("no inline consecutiveErrors field", () => {
    // Should use modeCtrl.consecutiveErrors, not this.consecutiveErrors
    expect(piSessionContent).not.toMatch(/private\s+consecutiveErrors/);
  });
});

describe("Architecture health summary", () => {
  it("total source modules ≥ 73", () => {
    const count = parseInt(execSync(
      "find src -name '*.ts' -not -name '*.test.ts' | wc -l",
      { cwd: root },
    ).toString().trim());
    expect(count).toBeGreaterThanOrEqual(73);
  });

  it("total test files ≥ 100", () => {
    const count = parseInt(execSync(
      "find src -name '*.test.ts' | wc -l",
      { cwd: root },
    ).toString().trim());
    expect(count).toBeGreaterThanOrEqual(100);
  });

  it("test-to-module ratio ≥ 1.2", () => {
    const srcCount = parseInt(execSync(
      "find src -name '*.ts' -not -name '*.test.ts' | wc -l",
      { cwd: root },
    ).toString().trim());
    const testCount = parseInt(execSync(
      "find src -name '*.test.ts' | wc -l",
      { cwd: root },
    ).toString().trim());
    expect(testCount / srcCount).toBeGreaterThanOrEqual(1.2);
  });
});
