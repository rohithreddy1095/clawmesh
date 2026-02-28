import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Run a test function with an isolated temp home directory.
 * Sets HOME, CLAWMESH_STATE_DIR, and cleans up afterwards.
 */
export async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "clawmesh-test-home-"));
  const origHome = process.env.HOME;
  const origStateDir = process.env.CLAWMESH_STATE_DIR;
  const origOpenClawStateDir = process.env.OPENCLAW_STATE_DIR;

  process.env.HOME = base;
  process.env.CLAWMESH_STATE_DIR = path.join(base, ".clawmesh");
  delete process.env.OPENCLAW_STATE_DIR;

  try {
    return await fn(base);
  } finally {
    if (origHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = origHome;
    }
    if (origStateDir === undefined) {
      delete process.env.CLAWMESH_STATE_DIR;
    } else {
      process.env.CLAWMESH_STATE_DIR = origStateDir;
    }
    if (origOpenClawStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = origOpenClawStateDir;
    }
    try {
      await fs.rm(base, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
}
