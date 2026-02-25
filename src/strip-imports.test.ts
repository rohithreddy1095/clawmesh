import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, ".");

/**
 * Stripped module paths — no remaining source file should import from these.
 * This test enforces that the ClawMesh fork is fully decoupled from
 * heavy subsystems that were removed.
 */
const STRIPPED_MODULES = [
  "browser",
  "canvas-host",
  "cron",
  "daemon",
  "discord",
  "imessage",
  "line",
  "link-understanding",
  "media",
  "media-understanding",
  "memory",
  "node-host",
  "pairing",
  "signal",
  "slack",
  "telegram",
  "tts",
  "tui",
  "web",
  "whatsapp",
  "wizard",
  "auto-reply",
  "hooks",
  "process",
  "scripts",
  "docs",
  "compat",
  "commands",
  "plugins",
  "test-helpers",
  "test-utils",
];

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

// Build a regex that matches import paths containing any stripped module name.
// Matches: import ... from "../../browser/..." or import ... from "../hooks/..."
const strippedPattern = new RegExp(
  `(?:from|import)\\s+["'](?:\\./|\\.\\./)(?:[^"']*/)?(${STRIPPED_MODULES.join("|")})/`,
);

describe("no imports from stripped modules", () => {
  const files = collectTsFiles(SRC);

  it("found source files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("no source file imports from a stripped module", () => {
    const violations: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (strippedPattern.test(line)) {
          const rel = path.relative(SRC, file);
          violations.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    if (violations.length > 0) {
      const summary = violations.slice(0, 50).join("\n");
      const extra = violations.length > 50 ? `\n... and ${violations.length - 50} more` : "";
      expect.fail(
        `Found ${violations.length} imports from stripped modules:\n${summary}${extra}`,
      );
    }
  });
});
