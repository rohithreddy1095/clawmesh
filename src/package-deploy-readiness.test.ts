import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readRootPackageJson(): Record<string, any> {
  const path = resolve(process.cwd(), "package.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("Production deploy readiness: published Pi SDK dependencies", () => {
  it("uses registry versions for Pi SDK packages instead of sibling file links", () => {
    const pkg = readRootPackageJson();
    const deps = pkg.dependencies ?? {};

    for (const name of [
      "@mariozechner/pi-agent-core",
      "@mariozechner/pi-ai",
      "@mariozechner/pi-coding-agent",
    ]) {
      const version = deps[name];
      expect(typeof version).toBe("string");
      expect(version).not.toContain("file:../pi-mono/");
      expect(version).toMatch(/^\^?\d+\.\d+\.\d+$/);
    }
  });
});
