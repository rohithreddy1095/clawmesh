// Measure handshake v2 wall time against a running node.
//
//   pnpm exec tsx scripts/handshake-bench.ts <ws-url> [iterations] [mesh-name]
//   pnpm exec tsx scripts/handshake-bench.ts ws://192.168.1.50:18789 20 bhoomi
//
// Uses this machine's persisted identity (CLAWMESH_STATE_DIR respected),
// which must already be trusted by the target node. Baseline 2026-07-05,
// 2-node WiFi LAN: total 3-msg p50 22.3 ms, mean 34.5 ms. Investigate
// anything worse than 2× baseline before merging further work.
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { loadOrCreateDeviceIdentity } from "../src/infra/device-identity.js";
import { buildMeshConnectAuth } from "../src/mesh/handshake.js";
import { deriveNamedMeshId } from "../src/mesh/mesh-identity.js";

const url = process.argv[2];
const iterations = Number(process.argv[3] ?? 20);
const meshName = process.argv[4] ?? "bhoomi";

if (!url) {
  console.error("usage: handshake-bench.ts <ws-url> [iterations] [mesh-name]");
  process.exit(2);
}

const identity = loadOrCreateDeviceIdentity();
const meshId = deriveNamedMeshId(meshName);

type Sample = { wsOpenMs: number; challengeMs: number; connectMs: number; totalMs: number };

function once(): Promise<Sample> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    let tOpen = 0;
    let tChallenge = 0;
    const ws = new WebSocket(url);
    const challengeId = randomUUID();
    const connectId = randomUUID();
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("timeout"));
    }, 10_000);

    ws.on("open", () => {
      tOpen = performance.now();
      ws.send(JSON.stringify({ type: "req", id: challengeId, method: "mesh.challenge", params: {} }));
    });
    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === challengeId) {
        tChallenge = performance.now();
        if (!msg.ok || !msg.payload?.nonce) {
          clearTimeout(timer);
          ws.close();
          return reject(new Error(`mesh.challenge failed: ${JSON.stringify(msg.error)}`));
        }
        const auth = buildMeshConnectAuth({
          identity,
          nonce: msg.payload.nonce,
          displayName: "handshake-bench",
          meshId,
          role: "viewer",
        });
        ws.send(
          JSON.stringify({
            type: "req",
            id: connectId,
            method: "mesh.connect",
            params: { version: 2, ...auth, clientNonce: randomUUID() },
          }),
        );
      } else if (msg.id === connectId) {
        const tDone = performance.now();
        clearTimeout(timer);
        ws.close();
        if (!msg.ok) {
          return reject(new Error(`mesh.connect rejected: ${msg.error?.code} ${msg.error?.message}`));
        }
        resolve({
          wsOpenMs: tOpen - t0,
          challengeMs: tChallenge - tOpen,
          connectMs: tDone - tChallenge,
          totalMs: tDone - tOpen,
        });
      }
    });
    ws.on("error", (e: Error) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function main() {
  const samples: Sample[] = [];
  for (let i = 0; i < iterations; i++) {
    try {
      samples.push(await once());
    } catch (e) {
      console.error(`iter ${i}: ${e}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!samples.length) {
    console.error("RESULT: no successful handshakes");
    process.exit(1);
  }
  const stat = (k: keyof Sample) => {
    const v = samples.map((s) => s[k]).sort((a, b) => a - b);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    return `mean=${mean.toFixed(1)}ms p50=${v[Math.floor(v.length / 2)].toFixed(1)}ms min=${v[0].toFixed(1)}ms max=${v[v.length - 1].toFixed(1)}ms`;
  };
  console.log(`handshake v2 timing over ${samples.length} runs against ${url} (mesh=${meshName})`);
  console.log(`  tcp+ws open:             ${stat("wsOpenMs")}`);
  console.log(`  challenge rtt:           ${stat("challengeMs")}`);
  console.log(`  sign+connect rtt:        ${stat("connectMs")}`);
  console.log(`  handshake total (3-msg): ${stat("totalMs")}`);
}
main();
