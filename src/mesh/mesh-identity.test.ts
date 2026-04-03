import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deriveNamedMeshId, loadOrCreateMeshId } from "./mesh-identity.js";

describe("mesh identity", () => {
  it("deriveNamedMeshId is deterministic for same name + originator", () => {
    const id1 = deriveNamedMeshId("bhoomi-main", "device-abc");
    const id2 = deriveNamedMeshId("bhoomi-main", "device-abc");
    expect(id1).toBe(id2);
  });

  it("deriveNamedMeshId changes when mesh name changes", () => {
    const id1 = deriveNamedMeshId("bhoomi-main", "device-abc");
    const id2 = deriveNamedMeshId("bhoomi-dev", "device-abc");
    expect(id1).not.toBe(id2);
  });

  it("loadOrCreateMeshId persists unnamed mesh ids", () => {
    const dir = mkdtempSync(join(tmpdir(), "mesh-id-test-"));
    try {
      const id1 = loadOrCreateMeshId({ stateDir: dir });
      const id2 = loadOrCreateMeshId({ stateDir: dir });
      expect(id1).toBe(id2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadOrCreateMeshId uses deterministic named mesh id", () => {
    const dir = mkdtempSync(join(tmpdir(), "mesh-id-test-"));
    try {
      const id = loadOrCreateMeshId({
        stateDir: dir,
        meshName: "bhoomi-main",
        originatorDeviceId: "device-abc",
      });
      expect(id).toBe(deriveNamedMeshId("bhoomi-main", "device-abc"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
