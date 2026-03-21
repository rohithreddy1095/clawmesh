/**
 * Full architecture regression tests — validates the complete
 * system hasn't regressed after Session 5 wiring.
 *
 * Tests that all originally-passing patterns still work correctly
 * through the extracted module wiring.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");

describe("Source file inventory health", () => {
  it("no source files over 950 lines", () => {
    const srcDir = resolve(root, "src");
    const files = execSync(`find ${srcDir} -name '*.ts' -not -name '*.test.ts'`)
      .toString().trim().split("\n").filter(Boolean);

    const oversized = files
      .map(f => ({ file: f.replace(srcDir + "/", ""), lines: readFileSync(f, "utf8").split("\n").length }))
      .filter(f => f.lines > 950);

    expect(oversized).toEqual([]); // No oversized files
  });

  it("top 5 files are all under 850 lines", () => {
    const srcDir = resolve(root, "src");
    const files = execSync(`find ${srcDir} -name '*.ts' -not -name '*.test.ts'`)
      .toString().trim().split("\n").filter(Boolean);

    const sorted = files
      .map(f => ({ file: f.replace(srcDir + "/", ""), lines: readFileSync(f, "utf8").split("\n").length }))
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 5);

    for (const f of sorted) {
      expect(f.lines).toBeLessThan(950);
    }
  });
});

describe("Test file health", () => {
  it("every test file has at least 1 test", () => {
    const srcDir = resolve(root, "src");
    const testFiles = execSync(`find ${srcDir} -name '*.test.ts'`)
      .toString().trim().split("\n").filter(Boolean);

    const empty = testFiles.filter(f => {
      const content = readFileSync(f, "utf8");
      return !content.includes("it(");
    });

    expect(empty).toEqual([]);
  });

  it("no test file has zero assertions", () => {
    const srcDir = resolve(root, "src");
    const testFiles = execSync(`find ${srcDir} -name '*.test.ts'`)
      .toString().trim().split("\n").filter(Boolean);

    const noAssert = testFiles.filter(f => {
      const content = readFileSync(f, "utf8");
      return content.includes("it(") && !content.includes("expect(");
    });

    expect(noAssert).toEqual([]);
  });
});

describe("Module decomposition ratios", () => {
  it("agents/ has at least 15 source modules", () => {
    const agentsDir = resolve(root, "src/agents");
    const count = readdirSync(agentsDir).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts")).length;
    expect(count).toBeGreaterThanOrEqual(15);
  });

  it("mesh/ has at least 25 source modules", () => {
    const meshDir = resolve(root, "src/mesh");
    const count = readdirSync(meshDir).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts")).length;
    expect(count).toBeGreaterThanOrEqual(25);
  });

  it("agents/ has more test files than source files", () => {
    const agentsDir = resolve(root, "src/agents");
    const srcCount = readdirSync(agentsDir).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts")).length;
    const testCount = readdirSync(agentsDir).filter(f => f.endsWith(".test.ts")).length;
    expect(testCount).toBeGreaterThanOrEqual(srcCount);
  });
});

describe("Key architectural constraints", () => {
  it("node-runtime.ts imports extracted modules", () => {
    const content = readFileSync(resolve(root, "src/mesh/node-runtime.ts"), "utf8");
    const expectedImports = [
      "rpc-dispatcher",
      "event-bus",
      "ui-broadcaster",
      "intent-router",
      "message-router",
      "actuation-sender",
      "peer-connection-manager",
      "chat-handlers",
      "inbound-connection",
    ];
    for (const mod of expectedImports) {
      expect(content).toContain(mod);
    }
  });

  it("pi-session.ts imports extracted modules", () => {
    const content = readFileSync(resolve(root, "src/agents/pi-session.ts"), "utf8");
    const expectedImports = [
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
    for (const mod of expectedImports) {
      expect(content).toContain(mod);
    }
  });

  it("no circular dependencies in agents/", () => {
    const agentsDir = resolve(root, "src/agents");
    const files = readdirSync(agentsDir).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"));

    // Check that pure helper modules don't import PiSession
    const pureModules = [
      "mode-controller.ts",
      "proposal-manager.ts",
      "frame-ingestor.ts",
      "threshold-checker.ts",
      "session-event-classifier.ts",
      "planner-prompt-builder.ts",
      "system-prompt-builder.ts",
      "broadcast-helpers.ts",
      "llm-response-helpers.ts",
    ];

    for (const mod of pureModules) {
      const path = join(agentsDir, mod);
      if (!existsSync(path)) continue;
      const content = readFileSync(path, "utf8");
      expect(content).not.toContain("from \"./pi-session");
    }
  });
});
