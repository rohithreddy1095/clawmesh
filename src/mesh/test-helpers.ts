import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadOrCreateDeviceIdentity, type DeviceIdentity } from "../infra/device-identity.js";
import { addTrustedPeer } from "./peer-trust.js";
import { MeshNodeRuntime, type MeshNodeRuntimeOptions } from "./node-runtime.js";

const origEnv = () => ({
  home: process.env.HOME,
  stateDir: process.env.CLAWMESH_STATE_DIR,
});

function restoreEnv(env: { home: string | undefined; stateDir: string | undefined }) {
  if (env.home === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = env.home;
  }
  if (env.stateDir === undefined) {
    delete process.env.CLAWMESH_STATE_DIR;
  } else {
    process.env.CLAWMESH_STATE_DIR = env.stateDir;
  }
}

/**
 * Run a test function with an isolated temp home directory.
 * Sets HOME, CLAWMESH_STATE_DIR, and cleans up afterwards.
 */
export async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "clawmesh-test-home-"));
  const env = origEnv();

  process.env.HOME = base;
  process.env.CLAWMESH_STATE_DIR = path.join(base, ".clawmesh");

  try {
    return await fn(base);
  } finally {
    restoreEnv(env);
    try {
      await fs.rm(base, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
}

export const noopTestLogger: NonNullable<MeshNodeRuntimeOptions["log"]> = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export type RuntimeHarnessNodeOptions = Omit<MeshNodeRuntimeOptions, "identity"> & {
  /** Stable filename/key for this node inside the harness temp directory. */
  name: string;
};

export type RuntimeHarnessNode = {
  name: string;
  identity: DeviceIdentity;
  runtime: MeshNodeRuntime;
  address: { host: string; port: number };
};

/**
 * Minimal multi-node runtime harness for integration-style TDD.
 * Spins up real MeshNodeRuntime instances on random ports inside one isolated state dir,
 * lets tests trust/connect them, and tears everything down cleanly.
 */
export class MeshRuntimeHarness {
  private baseDir: string | null = null;
  private env: { home: string | undefined; stateDir: string | undefined } | null = null;
  private readonly nodes: RuntimeHarnessNode[] = [];

  async setup(): Promise<void> {
    if (this.baseDir) return;
    this.baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawmesh-runtime-harness-"));
    this.env = origEnv();
    process.env.HOME = this.baseDir;
    process.env.CLAWMESH_STATE_DIR = path.join(this.baseDir, ".clawmesh");
  }

  async teardown(): Promise<void> {
    for (const node of [...this.nodes].reverse()) {
      try {
        await node.runtime.stop();
      } catch {
        // ignore teardown failures for test cleanup
      }
    }
    this.nodes.length = 0;

    if (this.env) {
      restoreEnv(this.env);
      this.env = null;
    }

    if (this.baseDir) {
      try {
        await fs.rm(this.baseDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
      this.baseDir = null;
    }
  }

  async startNode(opts: RuntimeHarnessNodeOptions): Promise<RuntimeHarnessNode | null> {
    if (!this.baseDir) {
      throw new Error("MeshRuntimeHarness.setup() must be called before startNode()");
    }

    const identity = loadOrCreateDeviceIdentity(path.join(this.baseDir, `${opts.name}.device.json`));
    const runtime = new MeshNodeRuntime({
      ...opts,
      identity,
      host: opts.host ?? "127.0.0.1",
      port: opts.port ?? 0,
      log: opts.log ?? noopTestLogger,
    });

    try {
      const address = await runtime.start();
      const node: RuntimeHarnessNode = { name: opts.name, identity, runtime, address };
      this.nodes.push(node);
      return node;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === "EPERM" || code === "EACCES") {
        try {
          await runtime.stop();
        } catch {
          // ignore best-effort cleanup
        }
        return null;
      }
      throw err;
    }
  }

  async trust(a: RuntimeHarnessNode, b: RuntimeHarnessNode): Promise<void> {
    await addTrustedPeer({ deviceId: a.identity.deviceId, displayName: a.runtime.displayName });
    await addTrustedPeer({ deviceId: b.identity.deviceId, displayName: b.runtime.displayName });
  }

  async connect(a: RuntimeHarnessNode, b: RuntimeHarnessNode, timeoutMs = 10_000): Promise<boolean> {
    await this.trust(a, b);
    a.runtime.connectToPeer({
      deviceId: b.identity.deviceId,
      url: this.urlFor(b),
    });

    const [aSeesB, bSeesA] = await Promise.all([
      a.runtime.waitForPeerConnected(b.identity.deviceId, timeoutMs),
      b.runtime.waitForPeerConnected(a.identity.deviceId, timeoutMs),
    ]);
    return aSeesB && bSeesA;
  }

  urlFor(node: RuntimeHarnessNode): string {
    return `ws://127.0.0.1:${node.address.port}`;
  }
}
