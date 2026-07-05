// Serve a deterministic fake LLM over the mesh — for wire-level hardware
// verification of llm.infer when no real model is available on the device.
//
//   pnpm exec tsx scripts/llm-serve-test.ts [port] [mesh-name]
//   # then from another machine:
//   pnpm exec tsx clawmesh.ts infer --model fake/model \
//     --peer "<deviceId>=ws://<host>:<port>" --mesh-name <mesh> "hi"
//   # expected stdout: mesh-ok
//
// Uses this machine's persisted identity (CLAWMESH_STATE_DIR respected);
// the calling peer must already be trusted. Verifies the PROTOCOL, not a
// model — real-model serving (e.g. nanochat) is a separate check.
import { loadOrCreateDeviceIdentity } from "../src/infra/device-identity.js";
import { MeshNodeRuntime } from "../src/mesh/node-runtime.js";
import type { MeshLlmProvider } from "../src/mesh/llm-types.js";

const port = Number(process.argv[2] ?? 18790);
const meshName = process.argv[3] ?? "bhoomi";
const MODEL = "fake/model";

const provider: MeshLlmProvider = {
  canServe: (m) => m === MODEL,
  infer: async function* () {
    yield { delta: "mesh" };
    yield { delta: "-ok" };
    return { finishReason: "stop", usage: { inputTokens: 1, outputTokens: 2 } };
  },
};

const runtime = new MeshNodeRuntime({
  identity: loadOrCreateDeviceIdentity(),
  host: "0.0.0.0",
  port,
  displayName: "llm-serve-test",
  meshName,
  disableDiscovery: true,
  serveLlmModels: [MODEL],
  llmProvider: provider,
  log: { info: (m) => console.log(m), warn: (m) => console.warn(m), error: (m) => console.error(m) },
});

runtime.start().then((a) => {
  console.log(`llm-serve-test listening ws://0.0.0.0:${a.port} model=${MODEL} mesh=${meshName}`);
});
