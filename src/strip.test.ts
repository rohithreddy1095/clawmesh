import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, ".");

describe("stripped modules", () => {
  const strippedDirs = [
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

  for (const dir of strippedDirs) {
    it(`src/${dir}/ does not exist`, () => {
      expect(fs.existsSync(path.join(SRC, dir))).toBe(false);
    });
  }
});
