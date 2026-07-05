#!/usr/bin/env tsx
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateDeviceIdentity } from "../src/infra/device-identity.js";
import { addTrustedPeer } from "../src/mesh/peer-trust.js";
import { MeshNodeRuntime } from "../src/mesh/node-runtime.js";
import type { MeshLlmProvider } from "../src/mesh/llm-types.js";

const MESH_NAME = "llm-smoke";
const MODEL = "fake/model";

async function withStateDir<T>(stateDir: string, fn: () => T | Promise<T>): Promise<T> {
  const previous = process.env.CLAWMESH_STATE_DIR;
  process.env.CLAWMESH_STATE_DIR = stateDir;
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.CLAWMESH_STATE_DIR;
    } else {
      process.env.CLAWMESH_STATE_DIR = previous;
    }
  }
}

async function main() {
  const base = await mkdtemp(join(tmpdir(), "clawmesh-llm-smoke-"));
  const serverState = join(base, "server");
  const clientState = join(base, "client");
  const previousStateDir = process.env.CLAWMESH_STATE_DIR;
  const previousHome = process.env.HOME;
  let runtime: MeshNodeRuntime | null = null;

  try {
    const serverIdentity = await withStateDir(serverState, () => loadOrCreateDeviceIdentity());
    const clientIdentity = await withStateDir(clientState, () => loadOrCreateDeviceIdentity());
    await withStateDir(serverState, () => addTrustedPeer({ deviceId: clientIdentity.deviceId }));
    await withStateDir(clientState, () => addTrustedPeer({ deviceId: serverIdentity.deviceId }));

    let chunkCount = 0;
    const provider: MeshLlmProvider = {
      canServe: (model) => model === MODEL,
      infer: async function* () {
        chunkCount++;
        yield { delta: "mesh" };
        chunkCount++;
        yield { delta: "-ok" };
        return { finishReason: "stop", usage: { inputTokens: 1, outputTokens: 2 } };
      },
    };

    process.env.HOME = serverState;
    process.env.CLAWMESH_STATE_DIR = serverState;
    runtime = new MeshNodeRuntime({
      identity: serverIdentity,
      host: "127.0.0.1",
      port: 0,
      displayName: "llm-smoke-server",
      meshName: MESH_NAME,
      disableDiscovery: true,
      serveLlmModels: [MODEL],
      llmProvider: provider,
      log: {
        info: () => {},
        warn: (msg) => console.warn(msg),
        error: (msg) => console.error(msg),
      },
    });
    const address = await runtime.start();

    const stdout = await runCliInfer({
      clientState,
      peerSpec: `${serverIdentity.deviceId}=ws://127.0.0.1:${address.port}`,
    });
    const rendered = stdout.trim();
    const worldFrames = runtime.worldModel.getRecentFrames(10);

    if (rendered !== "mesh-ok") {
      throw new Error(`unexpected infer stdout: ${JSON.stringify(rendered)}`);
    }
    if (chunkCount !== 2) {
      throw new Error(`expected 2 chunks, saw ${chunkCount}`);
    }
    if (worldFrames.length !== 0) {
      throw new Error(`llm.infer created ${worldFrames.length} world frames`);
    }

    console.log(`RESULT: stdout=${JSON.stringify(rendered)} chunks=${chunkCount} worldFrames=${worldFrames.length}`);
  } finally {
    if (runtime) {
      await runtime.stop();
    }
    if (previousStateDir === undefined) {
      delete process.env.CLAWMESH_STATE_DIR;
    } else {
      process.env.CLAWMESH_STATE_DIR = previousStateDir;
    }
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(base, { recursive: true, force: true });
  }
}

async function runCliInfer(opts: {
  clientState: string;
  peerSpec: string;
}): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      [
        "exec",
        "tsx",
        "clawmesh.ts",
        "infer",
        "--model",
        MODEL,
        "--peer",
        opts.peerSpec,
        "--mesh-name",
        MESH_NAME,
        "hello from smoke",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: opts.clientState,
          CLAWMESH_STATE_DIR: opts.clientState,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`clawmesh infer timed out\n${stderr}`));
    }, 15_000);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`clawmesh infer exited ${code}\n${stderr}`));
      }
    });
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
