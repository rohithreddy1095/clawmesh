# Handoff: Phase 2 — self-healing discovery + inference as a mesh capability

For: the next Claude Code session(s) on this repo. Read `CLAUDE.md` first
(charter, IP claim, conventions), then `PROTOCOL.md` (wire contract), then
the 2026-07-05 entries in `docs/ENGINEERING-LOG.md` (first real deployment:
what worked, what broke, measured numbers).

This file contains NO credentials and is safe to commit.

## Where things stand (verified live 2026-07-05)

- First real mesh is UP: Mac `mac-cc` (planner) ↔ Jetson `jetson-field-01`
  (field node, mock sensor + actuator), mesh name `bhoomi`, WiFi LAN.
- Handshake v2, context.sync, and the tier-gated actuation path are all
  verified over real hardware, including live-fired rejections
  (`ACTUATION_DECLARATION_REQUIRED`, `LLM_ONLY_ACTUATION_BLOCKED`) and a
  T3+human actuation that executed. Numbers (handshake p50 22 ms, ping RTT
  p50 8 ms, partition/rejoin recovery) are in the engineering log.
- Local commits through `9dd8a37` (not pushed to GitHub — see "Ask Rohith"
  below). The Jetson clone is fast-forwarded to the same tree on branch
  `deploy-20260705-c`.

### Boot commands that actually work

```bash
# Jetson (ssh jetson@<jetson-ip>, key-based auth; see "Jetson access")
cd ~/repo/clawmesh && nohup ./clawmesh.mjs start \
  --name jetson-field-01 --role field --field-node \
  --port 18789 --mesh-name bhoomi > ~/clawmesh-field.log 2>&1 &

# Mac
pnpm exec tsx clawmesh.ts start --name mac-cc --role planner \
  --command-center --mesh-name bhoomi \
  --peer "<jetsonDeviceId>=ws://<jetson-ip>:18789"

# UI (port 3000 may be taken; Next picks another via PORT env)
cd ui && pnpm dev
```

Jetson device ID: `2012691ee05b4bdbbf49989d49166766b101b8252f50b89728744894cdfcdc23`
Mac device ID:    `fb1621b47a389a492e6927cd2dec91e9f383701d153fca76b265f58503b0a387`

### Jetson access

- Host `rohith-jetson`, user `jetson`, key-based SSH (no password needed).
  The IP moves with DHCP (.39 → .50 already happened). Find it, then VERIFY
  it is the Jetson before sending anything: its ed25519 host key
  fingerprint must be `SHA256:fTE7beVBYROu6KGfslsVbA2bZ91FPAeJeE+aPtO7j78`
  (`ssh-keyscan -t ed25519 <ip> | ssh-keygen -lf -`).
- Deploy with `git push ssh://jetson@<ip>/home/jetson/repo/clawmesh
  HEAD:refs/heads/<new-branch>` then ssh + `git merge --ff-only` (pushing
  to the checked-out branch is rejected). Never rsync the working tree —
  gitignored files here can contain credentials.
- Node 22, no global pnpm — use `corepack pnpm`. Run the CLI as
  `./clawmesh.mjs` (it is a shell wrapper; `npx tsx clawmesh.mjs` fails).

## The phase mission

Two goals, in priority order, both serving the vision ("Bluetooth for
agents and hardware" → pooled local inference) and the contribution claim
(evidence provenance gating actuation at the protocol level):

1. **Make the mesh actually self-forming again** — mDNS discovery is
   broken on every node; the mesh only forms via static `--peer` entries
   today. "Self-forming" is in the patent claim's preamble; it must be true.
2. **Inference as a mesh capability** — advertise `llm:<provider/model>`,
   forward inference over the mesh with streaming, and make provenance
   survive it: anything an LLM produces is T0 planning inference and must
   remain hard-blocked from actuation even after crossing nodes. This
   extends the claimed composition (provenance survives capability
   forwarding) — record design decisions in the engineering log as
   invention-log entries.

Do the slices in order. Each slice is independently shippable, Red/Green,
and ends with the full mesh suite green (`pnpm exec vitest run src/mesh/`)
plus a real-hardware verification where noted.

---

## Slice 1 — Fix mDNS discovery

**Symptom (both platforms):** `mesh: mDNS discovery unavailable
(TypeError: this.responder.createServiceBrowser is not a function)`.

**Root cause (confirmed):** `src/mesh/discovery.ts` calls
`responder.createServiceBrowser(...)` on `@homebridge/ciao`. ciao is an
advertise/responder library; it has no browse API at all. Browsing never
worked against the published package.

**Decision (do not redesign):** keep ciao for advertising; add
`bonjour-service` (maintained, pure-JS) for the browse side. Do NOT swap
the advertise side — ciao's probing/conflict handling is fine and already
works.

- Browse for the same service type currently advertised (read it from
  `discovery.ts` — keep advertise and browse types identical).
- On discovery of a peer: feed it through the SAME code path as a static
  peer (`connectToPeer`), including the trust check — discovery must never
  bypass trust. Deny-by-default: an untrusted discovered peer gets logged,
  not connected.
- Discovered peers must carry deviceId in the TXT record so trust can be
  evaluated BEFORE dialing. If the current advertisement lacks a deviceId
  TXT field, add it (advertise side, ciao supports TXT).
- Handle self-discovery (seeing our own advertisement): ignore by deviceId.

**Acceptance:**
- Unit: browse→trust-gate→connect path tested with a fake browser.
- Hardware: start Jetson node WITHOUT `--peer` on the Mac side and confirm
  the mesh forms by discovery alone on the real LAN; `mesh.peers` on both
  sides. Do the reverse direction too. Record result in the engineering log.
- `--no-discovery` still works and static peers still take precedence.

## Slice 2 — CLI truth: wire `peers`, `world`, `info` to the running node

`clawmesh peers`, `clawmesh world`, and `clawmesh info` are placeholder
stubs that print hardcoded text (see `src/cli/clawmesh-cli.ts` around the
`// ── peers ──` section). This violates the "UI reflects backend truth"
convention. The `status` command already shows the correct pattern:
open a WS to `ws://localhost:18789` (accept `--url` override), send a
typed RPC, print the response, exit nonzero on failure.

- `peers` → `mesh.peers` (exists).
- `world` → needs a new RPC `mesh.world.query` returning the world model
  snapshot (recent frames, count, per-source breakdown). Add the RPC
  handler next to the existing `mesh.status`/`mesh.health` handlers, spec
  it in PROTOCOL.md, then use it from the CLI.
- `info` → local identity (already real) + live node info when reachable.

**Acceptance:** run against the live mesh; `peers` shows the Jetson,
`world` shows frames with `sourceDeviceId`/tier fields. Stubs deleted.

## Slice 3 — `llm:<model>` capability + streaming inference RPC (the core slice)

**Spec first:** write the PROTOCOL.md section before implementing.
Add the RPC methods, event, error codes, and the provenance rule to the
error registry / trust sections. The protocol is the product.

**Design decisions (made — do not reopen):**

- **Capability string:** `llm:<provider>/<model-id>` exactly matching the
  pi model-spec format already parsed by `src/agents/pi-session.ts`
  (`parseModelSpec`), e.g. `llm:nanochat/nano`,
  `llm:google/gemini-3.1-pro-preview`.
- **New CLI flag** `--serve-llm <provider/model>` (repeatable): on start,
  (a) resolve the model locally through the existing pi-session provider
  path (nanochat resolves via its OpenAI-compatible baseUrl — reuse, don't
  reimplement), (b) advertise the `llm:...` capability, (c) register the
  `llm.infer` handler. If the model fails to resolve, refuse to start with
  a clear error — never advertise a capability the node cannot serve.
- **Request:** `llm.infer` req params:
  `{ requestId: uuid, model: "provider/model-id",
     messages: [{role: "system"|"user"|"assistant", content: string}],
     maxTokens?: number, temperature?: number }`
- **Streaming:** server emits `llm.chunk` events
  `{ requestId, seq: number (from 0, no gaps), delta: string }`, then the
  final RPC `res` `{ requestId, finishReason: "stop"|"length"|"cancelled",
  usage?: {inputTokens, outputTokens} }`. Client reassembles by `seq`.
- **Cancellation:** `llm.cancel` req `{ requestId }` → in-flight stream
  ends with `finishReason: "cancelled"`.
- **Error codes:** `LLM_MODEL_UNAVAILABLE` (not advertised/not resolvable),
  `LLM_BUSY` (concurrency cap hit — cap is 1 concurrent inference per node
  for now; the Jetson Nano cannot do more), `LLM_TIMEOUT` (default 120 s,
  server-side), `LLM_BACKPRESSURE` (see below), `LLM_CANCELLED`.
- **Backpressure honesty:** the wire has none (documented in CLAUDE.md).
  Before sending each chunk, check `ws.bufferedAmount`; if it exceeds
  1 MiB, abort the stream with error `LLM_BACKPRESSURE`. Cap `delta` at
  8 KiB per chunk. Document in PROTOCOL.md that this is stream abort, not
  flow control — the control plane is not a data plane.
- **Provenance (the IP-relevant part, treat as load-bearing):**
  - Inference output NEVER enters the world model as an observation.
    `llm.chunk`/results are transient RPC payloads, not context frames.
  - If any caller wraps an inference result into a context frame or trust
    metadata, the only legal labeling is
    `evidence_sources: ["llm"]`, `evidence_trust_tier:
    "T0_planning_inference"`. Provide one helper that constructs this
    labeling and use it everywhere; no call site hand-writes the tier.
  - Required tests (these are the point of the feature):
    1. A command whose trust chain contains only forwarded-inference
       evidence targeting `actuator:*` is rejected
       `LLM_ONLY_ACTUATION_BLOCKED` — at the receiver gate AND the
       executor gate, exactly like local LLM output today.
    2. `llm.chunk` events do not ingest into the world model.
    3. A T0-labeled frame relayed through an intermediate node arrives
       still T0 (provenance survives multi-hop forwarding).
- **Client side:** `clawmesh infer --model <provider/model> [--peer ...]
  "prompt"` — finds a connected peer advertising the capability (via
  `MeshCapabilityRegistry`), streams the answer to stdout. This is the
  demo and the test harness.

**Stretch (only if the above is green and verified on hardware):** when
the local planner has no API key (current Mac state), let pi-session fall
back to a mesh peer advertising a suitable `llm:` capability via
`llm.infer`. Keep it behind a flag (`--planner-mesh-fallback`). The
planner's outputs remain T0 regardless of which node ran the model.

**Hardware verification:** serve nanochat on the Jetson (`--serve-llm
nanochat/<model-id>` — a nanochat setup exists on the Jetson from March;
check `~/repo/nanochat` there), run `clawmesh infer` from the Mac, watch
tokens stream. Record first-token latency and tokens/sec in the
engineering log. If the Jetson can't serve nanochat anymore, invert:
serve a model from the Mac and infer from the Jetson — direction doesn't
matter for the protocol claim.

## Slice 4 — Measurements at N=3

Today's numbers are 2-node. The gossip claims (hop-limit 3, seen-set
dedup) have never been observed with an indirect path.

- Third node: second process on the Mac. It MUST have its own identity:
  `CLAWMESH_STATE_DIR=~/.clawmesh-node3 pnpm exec tsx clawmesh.ts start
  --port 18790 --name mac-node3 --role node --mesh-name bhoomi
  --peer "<macDeviceId>=ws://localhost:18789"`
  (chain topology: node3 ↔ mac-cc ↔ jetson; node3 has NO direct Jetson
  link). Trust-exchange all pairs first (`trust add`, both directions).
  ⚠ Never run two nodes with the same identity/state dir — the registry
  is newest-wins per deviceId and the older session gets closed (this is
  by design; see 2026-07-05 log entry).
- Measure: (a) does a Jetson frame reach node3 (2 hops)? (b) end-to-end
  propagation via the `chat.subscribe` listener pattern (scripts from
  2026-07-05 are described in the log; rebuild in `scripts/` and commit
  them this time), (c) partition node3 → rejoin → does context.sync
  converge it through mac-cc?
- ⚠ Cross-host wall-clock offsets are ~60–380 ms — do NOT publish raw
  cross-host timestamp deltas as latency. Same-host (mac-cc → node3)
  deltas are valid; use ping RTT bounds for cross-host statements.
- Log all numbers in the engineering log with topology + N.

## Slice 5 (only if time) — typecheck debt

Pre-existing `tsc` errors in `src/agents/pi-session.ts`,
`src/mesh/discovery.ts`, `src/mesh/node-runtime.ts` from the published pi
SDK bump (`@mariozechner/*` pinned ^0.55.4, installs 0.73.1, deprecated in
favor of `@earendil-works/*`). Separate slice, no behavior changes, suite
stays green. Don't mix into the slices above.

---

## Known traps (all hit on 2026-07-05 — don't rediscover)

1. `pkill -f` over ssh matches the remote shell's own command line and
   kills the ssh session (exit 255). Kill by exact pid, or
   `pgrep -f 'clawmesh.ts start'` first.
2. Background node processes: `nohup ... &` over `ssh -f`, log to a file,
   verify with `pgrep` + log tail. The TUI flag (`--tui`) needs a TTY.
3. Ephemeral runtimes (`demo-actuate`, bench scripts) reuse the node's
   identity and mesh-id from `~/.clawmesh`. If the persisted mesh-id
   differs from the running mesh you get
   "peer belongs to mesh X, expected Y". The Mac's mesh-id file is already
   set to the `bhoomi`-derived id (sha256 of `clawmesh|mesh|bhoomi`).
4. Same-identity second connections displace the first (newest-wins) —
   expected, but it means bench tooling disconnects the real node; use a
   separate `CLAWMESH_STATE_DIR` identity for load/bench tools.
5. RPC probing without a mesh handshake works on any node port (that's
   how `status` works). UI event stream requires sending
   `{type:"req", method:"chat.subscribe"}` first.
6. Port 3000 on the Mac is often taken by an unrelated dev server; the UI
   must tolerate an alternate port (Next does via PORT env).
7. Suite counts: `src/mesh/` alone is 89 files / ~1300 tests and runs in
   ~20 s. Full repo suite is bigger; mesh + agents is the deploy gate.

## Ask Rohith (do not decide unilaterally)

- **GitHub push**: all Phase-1/2 commits are local-only. Public repo
  activity may be prior disclosure for the patent (CLAUDE.md IP-hygiene
  note). Get an explicit yes before pushing anything.
- **Jetson password rotation** is still pending (his action; key auth
  already works). The old password is compromised (was in chat logs).
- **Gemini API key** on the Mac is invalid — planner runs in `observing`
  mode until he replaces it (`clawmesh credential` / `~/.clawmesh/credentials.json`).

## Conventions that bit or mattered (reminders, not suggestions)

- Spec first for anything on the wire: PROTOCOL.md section lands in the
  same commit as the implementation, or earlier.
- Red/Green for mesh reliability and every trust-path change. Tests are
  risk-driven; do not pad counts.
- Never weaken the tier gate "temporarily" — it is the IP. New paths
  (inference forwarding!) must add enforcement points, not holes.
- Append a date-stamped engineering-log entry for every decision,
  milestone, or surprising measurement — it doubles as the invention log
  for the patent filing (conception dates matter).
- Farm/Bhoomi specifics stay out of `src/mesh/` — inference forwarding is
  generic; the farm planner is just its first consumer.

## Definition of done for this phase

1. Mesh forms on the real LAN with zero `--peer` flags (discovery works).
2. `clawmesh infer` streams a completion from a model running on the
   OTHER node, and the three provenance tests above are green.
3. N=3 measurements logged, including a 2-hop frame delivery observation.
4. PROTOCOL.md covers discovery TXT records and the full `llm.*` family.
5. Full mesh+agents suite green; engineering log updated; nothing pushed
   to GitHub without Rohith's explicit OK.
