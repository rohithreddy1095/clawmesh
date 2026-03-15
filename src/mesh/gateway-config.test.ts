import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadGatewayTargets, saveGatewayTarget, removeGatewayTarget } from "./gateway-config.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("gateway-config", () => {
  let originalStateDir: string | undefined;
  let tmpDir: string;

  beforeEach(() => {
    originalStateDir = process.env.CLAWMESH_STATE_DIR;
    tmpDir = mkdtempSync(join(tmpdir(), "gw-config-test-"));
    process.env.CLAWMESH_STATE_DIR = tmpDir;
  });

  afterEach(() => {
    if (originalStateDir !== undefined) {
      process.env.CLAWMESH_STATE_DIR = originalStateDir;
    } else {
      delete process.env.CLAWMESH_STATE_DIR;
    }
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it("returns empty array when no gateways file exists", () => {
    const targets = loadGatewayTargets();
    expect(targets).toEqual([]);
  });

  it("saves and loads a gateway target", () => {
    saveGatewayTarget({
      name: "jetson",
      url: "ws://192.168.1.39:18789",
    });

    const targets = loadGatewayTargets();
    expect(targets).toHaveLength(1);
    expect(targets[0].name).toBe("jetson");
    expect(targets[0].url).toBe("ws://192.168.1.39:18789");
  });

  it("updates existing target by name", () => {
    saveGatewayTarget({ name: "jetson", url: "ws://192.168.1.39:18789" });
    saveGatewayTarget({ name: "jetson", url: "ws://10.0.0.5:18789" });

    const targets = loadGatewayTargets();
    expect(targets).toHaveLength(1);
    expect(targets[0].url).toBe("ws://10.0.0.5:18789");
  });

  it("saves multiple distinct targets", () => {
    saveGatewayTarget({ name: "jetson-1", url: "ws://192.168.1.39:18789" });
    saveGatewayTarget({ name: "jetson-2", url: "ws://192.168.1.40:18789" });

    const targets = loadGatewayTargets();
    expect(targets).toHaveLength(2);
  });

  it("removes a target by name", () => {
    saveGatewayTarget({ name: "to-remove", url: "ws://10.0.0.1:18789" });
    saveGatewayTarget({ name: "to-keep", url: "ws://10.0.0.2:18789" });

    const removed = removeGatewayTarget("to-remove");
    expect(removed).toBe(true);

    const targets = loadGatewayTargets();
    expect(targets).toHaveLength(1);
    expect(targets[0].name).toBe("to-keep");
  });

  it("removeGatewayTarget returns false for nonexistent name", () => {
    const removed = removeGatewayTarget("nonexistent");
    expect(removed).toBe(false);
  });

  it("handles corrupt JSON file gracefully", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const gwDir = join(tmpDir, "mesh");
    fs.mkdirSync(gwDir, { recursive: true });
    fs.writeFileSync(join(gwDir, "gateways.json"), "not json");

    const targets = loadGatewayTargets();
    expect(targets).toEqual([]);
  });

  it("filters invalid entries", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const gwDir = join(tmpDir, "mesh");
    fs.mkdirSync(gwDir, { recursive: true });
    fs.writeFileSync(
      join(gwDir, "gateways.json"),
      JSON.stringify([
        { name: "valid", url: "ws://10.0.0.1:18789" },
        { name: "missing-url" },
        { url: "ws://missing-name" },
        null,
        42,
      ]),
    );

    const targets = loadGatewayTargets();
    expect(targets).toHaveLength(1);
    expect(targets[0].name).toBe("valid");
  });
});
