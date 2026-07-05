#!/usr/bin/env node
// Probe a running clawmesh node with a single RPC.
//
//   node scripts/mesh-rpc.mjs <ws-url> <method> [json-params]
//   node scripts/mesh-rpc.mjs ws://localhost:18789 mesh.peers
//   node scripts/mesh-rpc.mjs ws://192.168.1.50:18789 clawmesh.mock.actuator.state
//
// Prints the full response envelope as JSON. Exit 0 on ok:true, 1 otherwise.
// Works against any node port without a mesh handshake (RPC layer is
// currently unauthenticated — see PROTOCOL.md threat model).
import { WebSocket } from "ws";

const [url, method, paramsJson] = process.argv.slice(2);
if (!url || !method) {
  console.error("usage: mesh-rpc.mjs <ws-url> <method> [json-params]");
  process.exit(2);
}

const ws = new WebSocket(url);
const timer = setTimeout(() => {
  console.error(`timeout waiting for ${method} from ${url}`);
  process.exit(1);
}, 8000);

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      type: "req",
      id: "probe-1",
      method,
      params: paramsJson ? JSON.parse(paramsJson) : {},
    }),
  );
});
ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id === "probe-1") {
    clearTimeout(timer);
    console.log(JSON.stringify(msg, null, 2));
    ws.close();
    process.exit(msg.ok === false ? 1 : 0);
  }
});
ws.on("error", (err) => {
  clearTimeout(timer);
  console.error(String(err));
  process.exit(1);
});
