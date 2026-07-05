import { randomUUID } from "node:crypto";
import type { Command } from "commander";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { MeshNodeRuntime } from "../mesh/node-runtime.js";
import type { MeshStaticPeer } from "../mesh/types.mesh.js";
import { normalizeMeshName } from "./cli-config.js";

type ParsePeerSpec = (spec: string) => MeshStaticPeer;

export function registerInferCommand(program: Command, parsePeerSpec: ParsePeerSpec): void {
  program
    .command("infer")
    .description("Run an inference request on a connected mesh peer advertising llm:<provider/model>")
    .requiredOption("--model <provider/model>", "Model spec to request")
    .option(
      "--peer <deviceId=url>",
      'Peer to connect before lookup (format: "<deviceId>=<ws://host:port>")',
    )
    .option("--mesh-name <name>", "Stable named mesh identity to join")
    .option("--connect-timeout-ms <ms>", "Peer connect timeout", (v) => Number(v), 12_000)
    .option("--timeout-ms <ms>", "Inference timeout", (v) => Number(v), 120_000)
    .argument("<prompt...>", "Prompt text")
    .action(
      async (
        promptParts: string[],
        opts: {
          model: string;
          peer?: string;
          meshName?: string;
          connectTimeoutMs: number;
          timeoutMs: number;
        },
      ) => {
        await runInferCommand(promptParts, opts, parsePeerSpec);
      },
    );
}

async function runInferCommand(
  promptParts: string[],
  opts: {
    model: string;
    peer?: string;
    meshName?: string;
    connectTimeoutMs: number;
    timeoutMs: number;
  },
  parsePeerSpec: ParsePeerSpec,
): Promise<void> {
  const prompt = promptParts.join(" ").trim();
  if (!prompt) {
    throw new Error("missing prompt");
  }

  const identity = loadOrCreateDeviceIdentity();
  const peer = opts.peer ? parsePeerSpec(opts.peer) : undefined;
  const runtime = new MeshNodeRuntime({
    identity,
    host: "127.0.0.1",
    port: 0,
    displayName: "clawmesh-infer",
    meshName: normalizeMeshName(opts.meshName),
    capabilities: ["channel:clawmesh"],
    disableDiscovery: !!peer,
    log: {
      info: () => {},
      warn: (msg) => console.warn(msg),
      error: (msg) => console.error(msg),
    },
  });

  const requestId = randomUUID();
  const capability = `llm:${opts.model}`;
  const pending = new Map<number, string>();
  let nextSeq = 0;

  const flush = () => {
    while (pending.has(nextSeq)) {
      process.stdout.write(pending.get(nextSeq) ?? "");
      pending.delete(nextSeq);
      nextSeq++;
    }
  };

  const unsubscribe = runtime.eventBus.on("llm.chunk", ({ peerDeviceId, chunk }) => {
    if (chunk.requestId !== requestId) {
      return;
    }
    if (peer && peerDeviceId !== peer.deviceId) {
      return;
    }
    pending.set(chunk.seq, chunk.delta);
    flush();
  });

  try {
    await runtime.start();
    if (peer) {
      runtime.connectToPeer(peer);
      const connected = await runtime.waitForPeerConnected(peer.deviceId, opts.connectTimeoutMs);
      if (!connected) {
        throw new Error(`timed out waiting for peer ${peer.deviceId}`);
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, Math.min(opts.connectTimeoutMs, 2_000)));
    }

    const candidates = runtime.capabilityRegistry.findPeersWithCapability(capability);
    const targetDeviceId = peer?.deviceId ?? candidates[0];
    if (!targetDeviceId || !candidates.includes(targetDeviceId)) {
      throw new Error(`no connected peer advertises ${capability}`);
    }

    const result = await runtime.peerRegistry.invoke({
      deviceId: targetDeviceId,
      method: "llm.infer",
      params: {
        requestId,
        model: opts.model,
        messages: [{ role: "user", content: prompt }],
      },
      timeoutMs: opts.timeoutMs,
    });

    flush();
    process.stdout.write("\n");
    if (!result.ok) {
      const code = result.error?.code ? `${result.error.code}: ` : "";
      throw new Error(`${code}${result.error?.message ?? "llm.infer failed"}`);
    }
  } finally {
    unsubscribe();
    await runtime.stop();
  }
}
