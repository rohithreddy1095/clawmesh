#!/usr/bin/env node
// Subscribe to a running node's UI event stream and print context frames
// as they arrive. Used for propagation checks and hop-delivery tests.
//
//   node scripts/frame-listen.mjs <ws-url> [seconds] [sourceDeviceId-filter]
//   node scripts/frame-listen.mjs ws://localhost:18789 30
//   node scripts/frame-listen.mjs ws://localhost:19003 45 2012691ee05b...
//
// Prints one line per frame: frameId, kind, source, tier, delta between
// local receipt time and the frame's own timestamp.
// ⚠ Deltas are only meaningful when frame source and this listener are on
// the SAME host — cross-host clock offset is 60–380 ms on this LAN
// (measured 2026-07-05). For cross-host latency use ping RTT bounds.
// Exits 0 if at least one matching frame arrived, 1 otherwise.
import { WebSocket } from "ws";

const [url, secondsArg, sourceFilter] = process.argv.slice(2);
if (!url) {
  console.error("usage: frame-listen.mjs <ws-url> [seconds] [sourceDeviceId-filter]");
  process.exit(2);
}
const windowMs = (Number(secondsArg) || 30) * 1000;

const ws = new WebSocket(url);
const deltas = [];

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "req", id: "sub-1", method: "chat.subscribe", params: {} }));
});
ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type !== "event" || msg.event !== "context.frame") return;
  const f = msg.payload;
  if (sourceFilter && f?.sourceDeviceId !== sourceFilter) return;
  const delta = Date.now() - f.timestamp;
  deltas.push(delta);
  console.log(
    `${f.frameId?.slice(0, 8)} kind=${f.kind} source=${f.sourceDisplayName ?? f.sourceDeviceId?.slice(0, 12)} ` +
      `tier=${f.trust?.evidence_trust_tier} delta=${delta}ms`,
  );
});
ws.on("error", (err) => {
  console.error(String(err));
  process.exit(1);
});

setTimeout(() => {
  ws.close();
  if (!deltas.length) {
    console.log("RESULT: no matching frames observed");
    process.exit(1);
  }
  const v = [...deltas].sort((a, b) => a - b);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  console.log(
    `RESULT: ${v.length} frames, delta mean=${mean.toFixed(0)}ms ` +
      `p50=${v[Math.floor(v.length / 2)]}ms min=${v[0]}ms max=${v[v.length - 1]}ms`,
  );
  process.exit(0);
}, windowMs);
