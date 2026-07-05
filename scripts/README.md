# scripts/ — live-mesh test harness

The vitest suites (`pnpm exec vitest run src/mesh/ src/agents/`) are the
unit gate. These scripts are the OTHER half of verification: they run
against a live mesh — real hardware or a localhost mesh — and are how a
session proves its slice actually works on the wire. Built from the
2026-07-05 first-deployment tooling; see that engineering-log entry for
baseline numbers.

Agents: use these instead of rebuilding ad-hoc probes. If a script is
missing a capability you need, extend it in a commit (Red/Green where it
asserts behavior) — don't fork throwaway copies.

## No hardware? Use the localhost mesh

```bash
scripts/local-mesh.sh up 3     # 3-node chain on 127.0.0.1:19001-19003
scripts/local-mesh.sh status   # mesh.peers on every node
scripts/local-mesh.sh down     # stop (state kept); clean = delete all
```

Chain topology (`node3 → node2 → node1`), isolated identities via
`CLAWMESH_STATE_DIR`, trust pre-exchanged. Node 1 runs mock sensor +
actuator, so with `up 3` a node-1 frame arriving at node 3 is a genuine
2-hop gossip delivery, and the safety canary has a local target:

```bash
node scripts/frame-listen.mjs ws://127.0.0.1:19003 30      # watch 2-hop frames
scripts/safety-canary.sh ws://127.0.0.1:19001              # shots A+B locally
```

The localhost mesh validates protocol behavior. It does NOT count as the
hardware verification named in a slice's acceptance criteria — real-LAN
runs still required where the handoff says so.

## Tools

| Script | What it does |
|---|---|
| `mesh-rpc.mjs <url> <method> [json]` | One-shot RPC probe (`mesh.peers`, `mesh.status`, `clawmesh.mock.actuator.state`, …). Exit 0 on `ok:true`. |
| `frame-listen.mjs <url> [secs] [sourceId]` | Subscribe to a node's event stream, print context frames + tier. ⚠ timestamp deltas only valid same-host. |
| `llm-infer-smoke.ts` | Starts a deterministic localhost LLM-serving node, runs `clawmesh infer`, and verifies streamed chunks stay out of the world model. |
| `llm-serve-test.ts [port] [mesh]` | Serves a deterministic fake model over the mesh for cross-hardware `llm.infer` wire checks. |
| `safety-canary.sh <url> [deviceId]` | The three-shot actuation-gate invariant check. CANARY RED = stop all agent work (docs/OVERSIGHT.md). |
| `handshake-bench.ts <url> [n] [mesh]` | Handshake v2 timing. Baseline 2026-07-05: total p50 22.3 ms on WiFi LAN. Run via `pnpm exec tsx`. |
| `local-mesh.sh up/status/down/clean` | N-node localhost chain mesh, no hardware. |

Live Mac↔Jetson mesh targets and boot commands: see the active handoff in
`CLAUDE.md`. Measurement results go in `docs/ENGINEERING-LOG.md` with
topology + N.
