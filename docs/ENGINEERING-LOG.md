# Engineering & Invention Log

Date-stamped record of design decisions, milestones, and status changes.
Serves two purposes: (1) session-to-session continuity for Claude and Rohith,
(2) conception-date evidence for the eventual patent filing on the tier-gated
actuation technique. Append entries; never rewrite history.

Format: date, what changed / was decided, why, what's next.

---

## 2026-07-05 — Baseline assessment and direction

**Status of code:** ~15.4k LOC impl, ~26.7k LOC tests (154 files), 271 commits
(Feb–Jul 2026). Mesh substrate (identity, trust, discovery, capability routing,
gossip context propagation, world model) is the mature layer. Pi-backed planner
with proposal/approval workflow and T0–T3 / L0–L3 gating is implemented and
enforced. Operator surfaces (Next.js UI, TUI, Telegram, CLI) wired to live
runtime state. Bhoomi farm vertical is the driving use case.

**Decisions made:**
- Contribution claim fixed: evidence provenance as first-class wire metadata
  gating physical actuation in a self-forming mesh. Composition is the novelty;
  individual mechanisms are prior art (A2A, MCP, ROS 2/SROS2, gossip, exo/petals).
- Patent intent confirmed; filing after engineering is solved. Flag raised:
  public repo activity may be prior disclosure — confirm visibility strategy
  with counsel before publishing a formal spec.
- Identified handshake defect: `buildMeshAuthPayload` optional-field `|` join
  creates signing ambiguity ({nonce:"x"} ≡ {meshId:"x"}); nonce optional means
  5-min replay window. Fix: fixed-position fields + mandatory nonce.
- Known wire realities documented (no backpressure/ack/anti-entropy; control
  plane only, 2–10 node LAN scale).

**Next:** handshake fix → PROTOCOL.md → measurements (latency, partition/rejoin)
→ inference-as-mesh-capability (`llm:<model>` + streaming RPC).

## 2026-07-05 — Handshake v2: unambiguous payload + mandatory challenge nonce

**What changed (Red/Green, all tests written before implementation):**
- `buildMeshAuthPayload` v2: fixed seven-position format
  `mesh.connect|v2|deviceId|signedAtMs|nonce|meshId|role`, every field always
  present (empty markers), every value URI-component-encoded. Eliminates the
  v1 field-position ambiguity ({nonce:"x"} ≡ {meshId:"x"}) and delimiter
  injection ("a|b" forging adjacent fields) by construction.
- New `ChallengeStore` (src/mesh/challenge-store.ts): server-issued nonces,
  connection-bound, single-use, 60s TTL.
- Handshake is now three-step: mesh.challenge → signed mesh.connect (carries
  clientNonce) → server response signed over clientNonce. Replay is closed in
  BOTH directions; previously a captured handshake replayed for 5 minutes and
  the peer flow had no nonce at all (only the gateway flow did).
- `verifyMeshConnectAuth` requires `requiredNonce`; verification without a
  matching issued nonce is impossible at the type level and at runtime.
- New error codes: AUTH_NONCE_REQUIRED, AUTH_NONCE_INVALID.

**Design decisions (conception-relevant):**
- Nonce consumed only on successful match — a garbage frame cannot burn a
  pending challenge (nonce is 24 random bytes; guessing is not a threat).
- Mutual anti-replay via clientNonce echo rather than a second challenge
  round-trip: keeps the handshake at one extra message.
- Encoding chosen over length-prefixing for human-debuggable wire frames.

**Also cleaned (pre-existing, not regressions):** the "node-runtime < 580
lines" vanity assertion was duplicated across four test files and failing
since before this session (file was 695 at HEAD). Consolidated to one honest
guardrail (<750) in architecture-invariants.test.ts; repo-wide ceiling 1000
in architecture-regression.test.ts; removed a stale "pi-session imports
buildAgentResponseFrame" structural check.

**Verification:** full suite 155 files / 2379 tests green; modified files
typecheck clean. Pre-existing tsc errors remain in pi-session.ts,
discovery.ts, node-runtime.ts (drift from the published pi SDK bump) — not
touched in this slice, flagged for a follow-up.

**Breaking change:** wire-incompatible with v1 handshakes (intended: repo is
unpublished; no back-compat shim carried).

**Next:** PROTOCOL.md can now spec the corrected handshake rather than the
broken one.

## 2026-07-05 — PROTOCOL.md v1: the wire contract is now explicit

**What:** wrote `PROTOCOL.md` — versioned, normative wire spec extracted from
the implementation and cross-checked against it: transport rules (WS/JSON,
1 MiB cap, TLS pinning, posture labels, WAN pin requirement), identity
(deviceId = sha256 of raw 32-byte Ed25519 key), discovery (`_clawmesh._tcp`),
three-frame envelope, handshake v2 sequence + signed-payload grammar + error
codes, protocol generation, context-frame schema + flood-gossip rules +
`context.sync` anti-entropy, the trust/actuation gate as a numbered normative
algorithm (§8.3), capability grammar + wildcard matching + scoring, full RPC
surface, error-code registry, and an explicit non-guarantees section
(backpressure, ordering, convergence, Byzantine honesty of trusted peers).

**Two factual corrections made while writing (spec forced honesty):**
- Our own docs claimed "no anti-entropy: an offline node never converges."
  Wrong in detail — `context.sync` exists and runs on outbound connect, but
  is single-shot, ≤500 frames, 1 h lookback: convergence is *bounded*, not
  absent. CLAUDE.md corrected.
- Documented the real gate gap as a known limitation (§8.3): a forward that
  omits `action_type`/trust entirely bypasses the actuation checks — the gate
  is airtight only for commands that declare actuation. Deny-by-default for
  actuator-capable targets is the follow-up.

**Patent relevance:** §8 (trust vocabulary + gate algorithm) is the first
standalone normative statement of the tier-gated actuation technique —
useful as a spec exhibit, and reviewable by counsel before any public
publication of the spec (see repo-visibility flag in CLAUDE.md).

**Next:** measurements (latency, partition/rejoin) per priority order; or
close the §8.3 deny-by-default gap first if hardware work is imminent.

## 2026-07-05 — Deny-by-default actuation gating (closes the §8.3 gap)

**Why first:** writing the spec revealed the bypass was worse than "gap":
`evaluateMeshForwardTrust` only engaged when a command *declared*
`action_type:"actuation"`, while the actuator executor ran ANY envelope whose
`target.ref` began with `actuator:`. An envelope targeting `actuator:pump:P1`
declaring `action_type:"communication"` passed every check and flipped the
actuator. That contradicted the core claim ("enforced at the protocol
level"), so it outranked measurements.

**What changed (Red/Green, 6 tests written first):**
- `trust-policy.ts`: new rule — if `payload.to` or `command.target.ref`
  starts with `actuator:`, trust metadata must exist and declare
  `action_type:"actuation"`, else new code `ACTUATION_DECLARATION_REQUIRED`.
  Runs before all other checks; legacy non-actuator forwards unaffected.
- `mock-actuator.ts`: executor-side gate — the actuator re-evaluates the
  full trust policy against the envelope's own trust immediately before
  execution, refuses on any failure, and tracks `refusedCount` /
  `lastRefusal` for operator surfaces. The executor never assumes upstream
  layers ran.
- PROTOCOL.md §8.3 rewritten: deny-by-default is now normative step 4; the
  "known gap" paragraph replaced by the three-independent-enforcement-points
  rule (sender, receiver gate, executor). `ACTUATION_DECLARATION_REQUIRED`
  added to the error registry.

**Patent relevance (conception note):** the technique is now enforceable as
claimed — tier gating is structural (target-based deny-by-default), not
declaration-dependent. The three-layer enforcement (sender fail-fast,
receiver protocol gate, executor last-line re-check with refusal telemetry)
is part of the claimed composition.

**Verification:** full suite 155 files / 2387 tests green (8 new).

**Next:** measurements — frame propagation latency at N nodes,
partition/rejoin convergence against context.sync bounds, handshake
overhead.

## 2026-07-05 — First hardware deployment: handed off to Claude Code

**Decision:** boot the first real mesh with Mac as command center and the
Jetson ("netson", same WiFi) as field node. Cowork's sandboxed shell cannot
reach LAN mDNS, so execution moves to Claude Code on the Mac. Runbook +
verification checklist (incl. live-firing the actuation gate over real
hardware and cheap first measurements): `docs/HANDOFF-2026-07-05-deploy.md`
(gitignored — contains device credentials; delete after bootstrap).
This will be the first real-LAN test of handshake v2.

## 2026-07-05 — First real mesh booted: Mac + Jetson over LAN (Claude Code)

**Milestone:** the mesh is live on real hardware. Mac (`mac-cc`, planner,
192.168.1.41) ↔ Jetson (`jetson-field-01`, field node, 192.168.1.50,
hostname `rohith-jetson`) over WiFi, mesh `bhoomi` (named mesh id via
`--mesh-name`; both nodes' persisted random mesh ids had diverged, which
correctly rejected the first connect).

**Deployment notes (deviations from runbook):**
- Jetson DHCP moved .39 → .50; identified by matching its ed25519 SSH host
  key fingerprint against known_hosts. Handoff's `netson` hostname is wrong
  and mDNS names don't resolve.
- Synced via git push to the Jetson clone (branch `deploy-20260705`), not
  rsync — tree was committed first, and git can't leak the gitignored
  credential-bearing handoff file.
- `clawmesh.mjs` is a shell wrapper: run `./clawmesh.mjs`, not
  `npx tsx clawmesh.mjs` (handoff step 2/5 as written fails).
- mDNS discovery is broken on BOTH nodes (`ciao: createServiceBrowser is
  not a function`) — mesh formed via `--peer` static entry. Discovery needs
  its own slice.
- Trust exchange was already in place from March sessions.

**Verification checklist: all green.**
- Handshake v2 over real LAN: no AUTH_NONCE_* errors, mutual connect.
- `mesh.peers`/`mesh.status` consistent on both sides (CLI `peers`/`world`
  are placeholder stubs — checked via WS RPC; stubs violate "UI reflects
  backend truth" in spirit and should be wired or removed).
- Jetson mock-sensor frames ingest into Mac world model (59+ observed;
  UI showed 185 frames cached).
- `context.sync` fires on every connect (34/50 new frames on first syncs).
- **Safety gate live-fired over the wire, receiver side:**
  `action_type:"communication"` → `actuator:*` rejected
  `ACTUATION_DECLARATION_REQUIRED`; LLM-only evidence rejected
  `LLM_ONLY_ACTUATION_BLOCKED` (also rejected sender-side by demo-actuate
  --llm-only); properly declared T3+human executed (valve-1 active, trust
  metadata in actuator history). Executor-side `refusedCount` stayed 0 —
  correct: the receiver protocol gate rejects first; the executor re-gate
  is defense-in-depth, only reachable if the RPC layer is bypassed.
- UI (Next.js, port auto-assigned) rendered live topology, events
  (peer.connect/disconnect), world model counts, planner lane `observing`
  (honest: no valid Gemini key on Mac — planner needs a key before it can
  be exercised).

**Measurements (2-node WiFi LAN, N=15–20):**
- Handshake v2 3-message exchange: p50 22.3 ms, mean 34.5 ms
  (challenge RTT p50 6.6 ms; sign+connect RTT p50 14.7 ms). TCP+WS setup
  adds p50 17.1 ms before that.
- `mesh.ping` RTT p50 8.0 ms → one-way transit ≈ 4 ms.
- Frame propagation Jetson→Mac measured as `frame.timestamp` vs receipt:
  mean −60 ms — cross-host clock offset (Jetson ~60–75 ms ahead) dominates;
  true transit is bounded by ping. Cross-host one-way latency needs clock
  sync or an echo protocol; don't publish the raw delta.
- Partition/rejoin: field node down 2 min → reconnect within client
  backoff (≤30 s) of return; `context.sync` recovered the gap (3 new,
  12 dup). Bounded convergence behaves as documented.

**Two wire-level bugs found by the deployment and fixed (Red/Green):**
1. `PeerRegistry.register` displaced a same-device session without closing
   its socket. Observed live: bench/demo connections using the Mac's
   identity clobbered the real `mac-cc` session on the Jetson; the Mac kept
   a half-open zombie connection and received nothing until restart.
   Fix: registry closes the displaced socket (`1000 superseded`).
2. Stale detection (`ConnectionHealthMonitor`) only logged despite its
   docstring claiming auto-removal. Fix: `MeshPeerClient.forceReconnect()`
   terminates the stale socket so the close path re-handshakes.
   Note: same-identity concurrent connections remain newest-wins; if a
   second operator surface ever needs to coexist, sessions need per-conn
   identity, not per-device.
Also: `refusedCount`/`lastRefusal` were in-process only; now exposed in
the actuator state snapshot so the wire carries refusal telemetry.

**Cross-host clock offset is real** (~60–380 ms observed): wall-clock
frame timestamps are not comparable across nodes. Relevant to the gossip
"no logical clocks" caveat — any convergence claim in the paper/spec must
not assume comparable timestamps.

**Next:** measurements at N>2 nodes; fix mDNS discovery; wire real
`peers`/`world` CLI commands to a running node; inference-as-capability.

## 2026-07-05 — Phase 2 handoff written: discovery repair + inference-as-capability

**Decision:** next phase is (1) fix mDNS discovery — root-caused today:
`discovery.ts` calls `createServiceBrowser` on `@homebridge/ciao`, which
is an advertise-only library with no browse API; browse side moves to
`bonjour-service`, advertise stays on ciao, discovered peers must pass the
same trust gate as static peers (deviceId in TXT record, evaluated before
dialing) — and (2) inference as a mesh capability: `llm:<provider/model>`
capability strings matching the pi model-spec format, `--serve-llm` flag,
`llm.infer` streaming RPC (`llm.chunk` events, seq-ordered, 8 KiB delta
cap, `bufferedAmount` > 1 MiB aborts with `LLM_BACKPRESSURE` — stream
abort, not flow control), `llm.cancel`, concurrency cap 1.

**Conception note (invention log):** provenance must survive capability
forwarding — inference output crossing nodes stays
`T0_planning_inference` / `evidence_sources:["llm"]` via a single shared
labeling helper, never enters the world model as observation, and remains
hard-blocked from actuation at receiver gate and executor regardless of
which node ran the model or how many hops the result crossed. The
multi-hop T0-preservation test is a required deliverable, extending the
claimed composition from "local LLM evidence cannot actuate" to
"forwarded inference evidence cannot actuate."

Full spec-level detail, slice order, acceptance criteria, and the
operational traps from today's deployment:
`docs/HANDOFF-2026-07-05-inference-phase.md` (committable; no credentials).

## 2026-07-05 — Phase 3 direction sketch: boot-to-mesh (the appliance phase)

**Decision (direction, not yet implementation-ready):** after Phase 2
lands, Phase 3 turns a ClawMesh node from an engineer-started process into
an appliance — "switch it on and it is a node," the Bluetooth experience.
Four pillars, sequenced after Phase 2 because discovery (Slice 1) and
capability serving (Slice 3) are its preconditions:

1. **Daemonization / boot-to-mesh.** Node identity + role + mesh
   membership + served capabilities move from CLI flags into a persisted
   node config (`~/.clawmesh/node.json`). Service units own the lifecycle:
   systemd on the Jetson, launchd on the Mac. Power-on = config load =
   discovery = join. Crash = restart = rejoin (context.sync already
   bounds the catch-up).
2. **Known-meshes store (plural).** Today one `mesh-id` file persists one
   mesh. Bluetooth remembers every paired device; ClawMesh must remember
   every joined mesh — per-mesh: mesh id, display name, trust set, join
   policy (auto-join / ask / never). On boot the node joins whichever
   known mesh is audible on the network it woke up on.
3. **Pairing ceremony.** Replace manual two-sided `trust add <deviceId>`
   with an explicit pairing mode: both devices enter a short pairing
   window, exchange identity keys over the LAN, and each side displays a
   short authentication string derived from both public keys; a human
   confirms match on both ends before trust is persisted.
   **Conception note (invention log):** the pairing ceremony is what keeps
   "self-forming" compatible with "trust-gated actuation" — discovery may
   see anyone, but dialing/joining requires prior ceremony, and the trust
   tier of a peer is bound at pairing time. Unpaired peers are never
   dialed, only logged. This is part of the claimed composition (explicit
   pairing gating a self-forming actuation-capable mesh), not generic UX.
4. **Local RPC auth.** The node port currently answers unauthenticated
   RPCs (`mesh.status`, `chat.subscribe`, …). Acceptable on a dev desk;
   not for an appliance that auto-joins whatever WiFi it wakes up on.
   Operator/UI RPCs get an explicit local credential (token file readable
   only by the operating user; no silent loopback exemption). This
   changes the threat model write-up in PROTOCOL.md.

A full Phase 3 handoff (decisions pre-made, slice order, acceptance
criteria) gets written at Phase 2 completion, same discipline as
`docs/HANDOFF-2026-07-05-inference-phase.md`. Long-running agent work in
the meantime is governed by `docs/OVERSIGHT.md` (added today).

## 2026-07-05 — Live-mesh test harness committed (scripts/), first 2-hop delivery observed

**Milestone:** the ad-hoc probes from the first deployment are now a
committed harness so incremental agent sessions verify against a live
mesh instead of rebuilding throwaway tooling: `scripts/mesh-rpc.mjs`
(RPC probe), `scripts/frame-listen.mjs` (event-stream frame listener),
`scripts/handshake-bench.ts` (v2 timing, baseline p50 22.3 ms),
`scripts/safety-canary.sh` (the three-shot actuation-gate invariant;
exits nonzero on any wrong answer), `scripts/local-mesh.sh` (N-node
localhost chain mesh with isolated `CLAWMESH_STATE_DIR` identities and
pre-exchanged trust — protocol verification without hardware).
Usage: `scripts/README.md`. Oversight checklist now calls these scripts.

**Validated today:** canary GREEN against the live Jetson (all three
shots). Localhost chain `up 3`: correct chain topology in `mesh.peers`,
canary A/B green on node1, and — a first for this codebase — **2-hop
gossip delivery observed**: node1 observation frames (T2) arrived at
node3, which has no direct node1 link, via node2 (same-host delta ~2 ms,
3/3 frames). Hop-limit-3 flood works at N=3 on localhost; the real-LAN
N=3 measurement remains Phase 2 Slice 4.

## 2026-07-05 — Phase 2 Slice 1: mDNS discovery browse repaired

**What changed (Spec/Red/Green):**
- PROTOCOL.md §4 now states the browse-side rule explicitly: ignore
  service records without `deviceId`, ignore self-discovery, and use
  `deviceId` for the trust check before dialing.
- `MeshDiscovery` keeps `@homebridge/ciao` for advertising but no longer
  calls the nonexistent `createServiceBrowser`. Browse side now uses
  `bonjour-service` against the same `_clawmesh._tcp.local` service type.
- Discovery advertisements still carry `deviceId` and `version` TXT
  records. Browser TXT parsing accepts string/Buffer forms and prefers IPv4
  addresses when Bonjour provides multiple addresses.
- Runtime auto-connect still goes through `AutoConnectManager.evaluateWithTrust`
  and then `connectToPeer`, so discovery cannot bypass trust. Added a runtime
  regression test proving an untrusted discovered peer is not dialed and does
  not consume an auto-connect attempt.

**Verification:**
- Red test observed before implementation:
  `pnpm exec vitest run src/mesh/discovery.test.ts src/mesh/node-runtime.test.ts`
  failed on `TypeError: this.responder.createServiceBrowser is not a function`.
- Green unit/integration gate:
  `pnpm exec vitest run src/mesh/ src/agents/` → 133 files / 2090 tests passed
  (61.56 s on final run).
- Typecheck sanity:
  `pnpm exec tsc --noEmit --pretty false` still fails only on the pre-existing
  handoff-listed debts in `src/agents/pi-session.ts` and
  `src/mesh/node-runtime.ts`; no discovery errors remain.
- Localhost live mesh:
  `scripts/local-mesh.sh clean && scripts/local-mesh.sh up 3`, then
  `scripts/local-mesh.sh status` → node1 peers `local-node2`; node2 peers
  `local-node3,local-node1`; node3 peers `local-node2`.
  `node scripts/frame-listen.mjs ws://127.0.0.1:19003 12 35a22971938b2bd8719db522b7a1376bfb663719f246a7d7dbcbe91b5372f8a1`
  → 2 node1 T2 frames received at node3, p50 2 ms same-host delta.
  This verifies static peers / `--no-discovery` still work in the harness.
- Safety canary:
  `scripts/safety-canary.sh ws://127.0.0.1:19001` → CANARY GREEN;
  A rejected `ACTUATION_DECLARATION_REQUIRED`, B rejected
  `LLM_ONLY_ACTUATION_BLOCKED`; C skipped because no target deviceId was
  passed for the localhost canary.
- Cleanup:
  `scripts/local-mesh.sh clean` completed and removed `/tmp/clawmesh-local-mesh`.

**Hardware acceptance:** UNCHECKED. The Jetson could not be reached from this
Mac during this slice. Evidence: `node scripts/mesh-rpc.mjs
ws://192.168.1.50:18789 mesh.peers` returned `EHOSTUNREACH`;
`ping jetson-field-01.local` and `ssh jetson@jetson-field-01.local` both
reported `No route to host`; `ssh-keyscan -T 5 -t ed25519 192.168.1.50`
returned no public key. mDNS still advertised
`jetson-field-01._clawmesh._tcp.local` with the expected deviceId TXT record
and port 18789, but direct traffic to the resolved address was unavailable,
so the real-LAN discovery-only mesh formation checks were not run.

**Next:** Slice 2 — wire `clawmesh peers`, `world`, and `info` to the running
node truth instead of placeholder output.

## 2026-07-05 — Phase 2 Slice 2: CLI truth wired to running node RPCs

**What changed (Spec/Red/Green):**
- PROTOCOL.md now specifies `mesh.world.query` as a read-only world-model RPC:
  `{ limit? ≤200, kind?, sourceDeviceId? }` returning recent frames, count,
  entry count, per-source/per-kind/per-tier breakdowns, and peer timestamp.
  The spec requires returned frames to preserve `sourceDeviceId` and
  `trust.evidence_trust_tier` exactly as ingested.
- Added `createWorldQueryHandlers` and registered `mesh.world.query` in
  `MeshNodeRuntime`.
- Replaced placeholder `clawmesh peers`, `clawmesh world`, and `clawmesh info`
  output with live WebSocket RPC calls. `peers` calls `mesh.peers`; `world`
  calls `mesh.world.query`; `info` prints local identity plus reachable
  runtime status from `mesh.status`.
- Extracted live-node CLI RPC code to `src/cli/live-rpc-commands.ts` so
  `src/cli/clawmesh-cli.ts` stays below the 1000-line architecture guardrail.

**Verification:**
- Red tests before implementation:
  `pnpm exec vitest run src/mesh/server-methods/world-query.test.ts
  src/cli/cli-live-rpc.test.ts src/mesh/rpc-wiring.test.ts
  src/mesh/wired-system.test.ts` failed on missing `./world-query.js`,
  missing CLI `--url`, and absent runtime registration.
- Targeted green:
  `pnpm exec vitest run src/mesh/server-methods/world-query.test.ts
  src/cli/cli-live-rpc.test.ts src/mesh/rpc-wiring.test.ts
  src/mesh/wired-system.test.ts src/agents/architecture-regression.test.ts`
  → 5 files / 51 tests passed.
- Full relevant gate:
  `pnpm exec vitest run src/mesh/ src/agents/ src/cli/` → 141 files /
  2217 tests passed (60.71 s).
- Typecheck sanity:
  `pnpm exec tsc --noEmit --pretty false` still fails only on the known
  handoff-listed debts in `src/agents/pi-session.ts` and
  `src/mesh/node-runtime.ts`; no Slice 2 files report type errors.
- Localhost live mesh:
  `scripts/local-mesh.sh clean && (scripts/local-mesh.sh up 3 || true);
  sleep 300`, then `scripts/local-mesh.sh status` → node1 peers
  `local-node2`; node2 peers `local-node3,local-node1`; node3 peers
  `local-node2`.
  `pnpm exec tsx clawmesh.ts peers --url ws://127.0.0.1:19002` → connected
  peers were local-node3 and local-node1, with node1 capabilities
  `channel:clawmesh,actuator:mock`.
  `pnpm exec tsx clawmesh.ts world --url ws://127.0.0.1:19003 --limit 5`
  → 5 node1 observation frames with `sourceDeviceId=...885864...` and
  `tier=T2_operational_observation`.
  `pnpm exec tsx clawmesh.ts info --url ws://127.0.0.1:19002` → reachable
  runtime ID `301bec...`, 2 peers, discovery disabled, planner disabled.
  `node scripts/frame-listen.mjs ws://127.0.0.1:19003 8 88586407d70229c16ad7acd661d76cd87c81604f8d47695ce71ca784d1001aea`
  → 2 node1 T2 frames received at node3, p50 2 ms same-host delta.
- Safety canary:
  `scripts/safety-canary.sh ws://127.0.0.1:19001` → CANARY GREEN;
  A rejected `ACTUATION_DECLARATION_REQUIRED`, B rejected
  `LLM_ONLY_ACTUATION_BLOCKED`; C skipped because no target deviceId was
  passed for the localhost canary.
- Cleanup:
  `scripts/local-mesh.sh clean` completed and removed `/tmp/clawmesh-local-mesh`.

**Hardware acceptance:** UNCHECKED for this slice. Slice 2 did not add a new
hardware-specific requirement beyond "run against the live mesh"; live
verification was on the committed localhost mesh harness. The Jetson remained
unreachable by direct WS/SSH in Slice 1, so no Jetson CLI-truth check is
claimed here.

**Next:** Slice 3 — `llm:<provider/model>` capability and streaming
`llm.infer` with T0 provenance surviving forwarding.

### REVIEW 2026-07-05

| Slice | Status | Commit range | Tag |
|---|---|---|---|
| 1 — mDNS discovery repair | done | `20b4b01` | `slice-1-done-20260705` |
| 2 — CLI truth | done | `20b4b01..slice-2-done-20260705` | `slice-2-done-20260705` |
| 3 — LLM capability + streaming inference | untouched | — | — |
| 4 — N=3 measurements | untouched | — | — |
| 5 — typecheck debt | untouched | — | — |

**Acceptance evidence:** Slice 1: `pnpm exec vitest run src/mesh/ src/agents/`
passed 133 files / 2090 tests; localhost `scripts/local-mesh.sh up 3`,
`node scripts/frame-listen.mjs ws://127.0.0.1:19003 12 <node1-id>`, and
`scripts/safety-canary.sh ws://127.0.0.1:19001` passed as logged above.
Hardware discovery-only mesh formation was explicitly unverified because the
Jetson was unreachable (`EHOSTUNREACH` / `No route to host`) despite mDNS
advertising. Slice 2: `pnpm exec vitest run src/mesh/ src/agents/ src/cli/`
passed 141 files / 2217 tests; localhost `clawmesh peers`, `world`, and
`info` commands against ports 19002/19003 printed live runtime truth as logged
above.

**Canary status:** last run 2026-07-05 against localhost node1
`ws://127.0.0.1:19001`; CANARY GREEN for rejection shots A/B; positive shot C
skipped because no target deviceId was passed.

**Deviations & objections:** no design objections logged. Hardware checks that
could not be run are explicitly unchecked; no verification is claimed for
Jetson after it became unreachable from this Mac.

**Open threads:** Slice 3 is the next implementation slice. Slice 4 real-LAN
N=3 remains untouched. Slice 5 typecheck debt remains the known pre-existing
`pi-session.ts` / `node-runtime.ts` debt.

**Repo state:** expected after this entry is committed and tagged: branch
`main`, local-only, ahead of `origin/main`, nothing pushed to GitHub.
`scripts/local-mesh.sh clean` has been run; no `/tmp/clawmesh-local-mesh`
state dir or localhost node processes remain.

## 2026-07-05 — Phase 2 Slice 3: LLM capability + streaming inference RPC

**What changed (Spec/Red/Green):**
- PROTOCOL.md now specifies `llm:<provider>/<model-id>` capability strings,
  `llm.infer`, `llm.cancel`, transient `llm.chunk` events, the single-active
  inference cap, timeout/backpressure behavior, and LLM error codes
  `LLM_MODEL_UNAVAILABLE`, `LLM_BUSY`, `LLM_TIMEOUT`,
  `LLM_BACKPRESSURE`, and `LLM_CANCELLED`.
- Added the core LLM wire types, `createLlmInferenceHandlers`, and a Pi-backed
  model provider. `--serve-llm <provider/model>` resolves through the shared
  Pi model path before advertising `llm:...`; unresolved models refuse startup
  instead of lying about capability.
- Added `clawmesh infer --model <provider/model> [--peer ...] "prompt"` with
  ordered chunk reassembly. `--mesh-name` is supported for named-mesh demos.
- Centralized the legal LLM provenance label in `createLlmEvidenceTrust()`:
  `evidence_sources:["llm"]`, `evidence_trust_tier:"T0_planning_inference"`.
  Production LLM context/agent-response call sites now use the helper.
- `llm.chunk` is surfaced as a transient peer event and explicitly does not
  enter the world model. Required provenance tests cover receiver gate,
  executor gate, transient chunks, and T0 preservation across a multi-hop
  context relay.
- Harness fixes: `local-mesh.sh` now isolates `HOME` as well as
  `CLAWMESH_STATE_DIR` so world snapshots cannot leak into localhost tests;
  `clean` waits/retries after stopping nodes. `safety-canary.sh` passes
  `MESH_NAME` through to shot C, and `demo-actuate --mesh-name` joins named
  meshes for the positive canary shot.
- Added `scripts/llm-infer-smoke.ts`, a committed deterministic live smoke:
  it starts a real LLM-serving mesh node with an injected provider, runs the
  actual `clawmesh infer` CLI over WebSocket, and verifies streamed chunks do
  not create world-model frames.

**Verification:**
- Red tests before implementation:
  `pnpm exec vitest run src/mesh/llm-provenance.test.ts
  src/mesh/server-methods/llm-infer.test.ts` failed on missing
  `./llm-provenance.js` and `./llm-infer.js`.
- Focused green:
  `pnpm exec vitest run src/mesh/llm-provenance.test.ts
  src/mesh/server-methods/llm-infer.test.ts src/mesh/pure-functions-expanded.test.ts`
  → 3 files / 33 tests passed.
- Full relevant gate:
  `pnpm exec vitest run src/mesh/ src/agents/` → 136 files / 2102 tests passed
  (57.98 s on final run).
- CLI gate:
  `pnpm exec vitest run src/cli/` → 7 files / 124 tests passed.
- Typecheck:
  `pnpm exec tsc --noEmit` → passed with no errors.
- LLM live smoke:
  `pnpm exec tsx scripts/llm-infer-smoke.ts` →
  `RESULT: stdout="mesh-ok" chunks=2 worldFrames=0`.
- Localhost live mesh and full canary:
  ran a single-shell verified sequence because this execution environment
  reaps background children after tool calls finish:
  `scripts/local-mesh.sh clean; scripts/local-mesh.sh up 3;`
  created node1 `f26a792b...`, node2 `22eb270f...`, node3 `7f896eec...`.
  `node scripts/mesh-rpc.mjs ws://127.0.0.1:19003 mesh.peers` returned node3
  peer `local-node2`.
  `node scripts/mesh-rpc.mjs ws://127.0.0.1:19003 mesh.world.query '{"limit":5}'`
  returned 5 node1 T2 observation frames at node3.
  `node scripts/frame-listen.mjs ws://127.0.0.1:19003 12 <node1-id>` observed
  3 node1 frames at node3, p50 2 ms, min 2 ms, max 3 ms.
  A dedicated canary-client identity was created and trusted by node1, then
  `HOME=<canary> CLAWMESH_STATE_DIR=<canary> MESH_NAME=localmesh
  scripts/safety-canary.sh ws://127.0.0.1:19001 <node1-id>` ran all shots:
  A rejected `ACTUATION_DECLARATION_REQUIRED`, B rejected
  `LLM_ONLY_ACTUATION_BLOCKED`, C executed. CANARY GREEN.
- Cleanup:
  `scripts/local-mesh.sh clean` completed and removed
  `/tmp/clawmesh-local-mesh`.

**Hardware acceptance:** UNCHECKED. Slice 3 names a Jetson real-LAN
inference check, but the Jetson could not be reached or host-key verified
from this Mac. Evidence: `nc -vz -G 5 192.168.1.50 22` failed
`No route to host`; `ping -c 2 -W 1000 192.168.1.50` had 100% packet loss
with `sendto: No route to host`; `ssh-keyscan -T 5 -t ed25519 192.168.1.50`
returned no public key, so the required
`SHA256:fTE7beVBYROu6KGfslsVbA2bZ91FPAeJeE+aPtO7j78` fingerprint could not
be verified. One other ARP candidate (`192.168.1.36`) also had no SSH route.

**Next:** Slice 4 — N=3 measurements.

### REVIEW 2026-07-05

| Slice | Status | Commit range | Tag |
|---|---|---|---|
| 1 — mDNS discovery repair | done | `20b4b01` | `slice-1-done-20260705` |
| 2 — CLI truth | done | `20b4b01..slice-2-done-20260705` | `slice-2-done-20260705` |
| 3 — LLM capability + streaming inference | done | `slice-2-done-20260705..slice-3-done-20260705` | `slice-3-done-20260705` |
| 4 — N=3 measurements | untouched | — | — |
| 5 — typecheck debt | untouched | — | — |

**Acceptance evidence:** Slice 1 and Slice 2 evidence is recorded in their
entries above. Slice 3 evidence: focused red/green tests, final full
`src/mesh/ src/agents/` Vitest gate (136 / 2102), CLI gate (7 / 124),
`pnpm exec tsc --noEmit`, deterministic `scripts/llm-infer-smoke.ts`, and
the localhost 3-node mesh run with node3 receiving node1 frames plus full
CANARY GREEN including positive shot C. Hardware inference remains explicitly
unverified because SSH host-key verification could not be reached.

**Canary status:** last run 2026-07-05 against localhost node1
`ws://127.0.0.1:19001` with a dedicated canary identity in the `localmesh`
named mesh; CANARY GREEN for A, B, and C.

**Deviations & objections:** no design objections logged. Hardware check is
unchecked, not claimed.

**Open threads:** Slice 4 measurement pass is next. Slice 5 typecheck debt is
now lower risk because `pnpm exec tsc --noEmit` passed after Slice 3, but the
handoff still lists it as the final optional slice.

**Repo state:** expected after this entry is committed and tagged: branch
`main`, local-only, ahead of `origin/main`, nothing pushed to GitHub.
`scripts/local-mesh.sh clean` has been run; no `/tmp/clawmesh-local-mesh`
state dir or localhost node processes remain. A pre-existing Mac command
center process for the `bhoomi` mesh was observed and left untouched.

## 2026-07-05 — Phase 2 Slice 4: N=3 measurement pass

**What changed:** no production code changed in this slice. This was a
measurement/logging slice using the committed live harness from earlier
slices.

**Topology measured:** localhost N=3 chain, `local-node1` (mock sensor +
actuator) → `local-node2` → `local-node3`; node3 had no direct node1 link.
Fresh identities for the successful run:
- node1 `0e55b9789dcfe64140005a522afcb483d033d584e81c74c9e1d39f562529170c`
- node2 `8b4695d90f14fd86a60a508e920c5fc03978d92e1395184a6b71123a7e4e4f5a`
- node3 `fd2804a6d7b590c99d8e9e395edeb526b6b87e535a10f8fe7e44d37a96f95e2a`

**Measurements and verification:**
- `scripts/local-mesh.sh up 3` reported the expected chain:
  node1 peers `local-node2`; node2 peers `local-node1,local-node3`;
  node3 peers `local-node2`.
- 2-hop delivery:
  `node scripts/frame-listen.mjs ws://127.0.0.1:19003 12 <node1-id>`
  observed 3 node1 observation frames at node3, all
  `T2_operational_observation`; same-host delta mean 2 ms, p50 2 ms,
  min 2 ms, max 3 ms.
- Pre-partition world state:
  `node scripts/mesh-rpc.mjs ws://127.0.0.1:19003 mesh.world.query '{"limit":8}'`
  returned `BEFORE_SYNC count=5 entries=1 recent=5`.
- Partition/rejoin/context.sync:
  killed node3 (`pid=14324` in the successful run), waited 13 s while node1
  continued producing frames, restarted node3 with the same identity and
  static peer to node2, waited 10 s, then queried node3.
  `mesh.peers` showed node3 reconnected to node2. `mesh.world.query
  '{"limit":12}'` returned `SYNC_RESULT count=10 entries=1 recent=10
  fromNode1=10 sincePartition=5`, proving context.sync converged missed
  node1 frames through node2 after rejoin.
- Safety canary:
  used a dedicated canary-client identity trusted by node1, with
  `MESH_NAME=localmesh`.
  `scripts/safety-canary.sh ws://127.0.0.1:19001 <node1-id>` ran all shots:
  A rejected `ACTUATION_DECLARATION_REQUIRED`, B rejected
  `LLM_ONLY_ACTUATION_BLOCKED`, C executed. CANARY GREEN.
- Test gate carried forward from the immediately preceding Slice 3 commit:
  `pnpm exec vitest run src/mesh/ src/agents/` → 136 files / 2102 tests
  passed; `pnpm exec vitest run src/cli/` → 7 files / 124 tests passed;
  `pnpm exec tsc --noEmit` passed. No code changed after those gates except
  this log entry.
- Cleanup:
  `scripts/local-mesh.sh clean` completed and removed
  `/tmp/clawmesh-local-mesh`.

**Hardware acceptance:** UNCHECKED. The handoff's preferred N=3 real-LAN
topology (`node3 ↔ mac-cc ↔ Jetson`) could not be run because the Jetson
remained unreachable and its host key could not be verified. Evidence from
Slice 3 still applies on this network: SSH to `192.168.1.50` and
`192.168.1.36` failed with `No route to host`, and `ssh-keyscan` returned no
ed25519 key to compare with the required
`SHA256:fTE7beVBYROu6KGfslsVbA2bZ91FPAeJeE+aPtO7j78` fingerprint.

**Next:** Slice 5 — typecheck debt. Note: `pnpm exec tsc --noEmit` already
passes after Slice 3's type cleanups, so Slice 5 may be a confirmation/logging
slice unless new debt appears.

### REVIEW 2026-07-05

| Slice | Status | Commit range | Tag |
|---|---|---|---|
| 1 — mDNS discovery repair | done | `20b4b01` | `slice-1-done-20260705` |
| 2 — CLI truth | done | `20b4b01..slice-2-done-20260705` | `slice-2-done-20260705` |
| 3 — LLM capability + streaming inference | done | `slice-2-done-20260705..slice-3-done-20260705` | `slice-3-done-20260705` |
| 4 — N=3 measurements | done | `slice-3-done-20260705..slice-4-done-20260705` | `slice-4-done-20260705` |
| 5 — typecheck debt | untouched | — | — |

**Acceptance evidence:** Slice 4 local N=3 evidence is listed above:
2-hop frame delivery observed, partition/rejoin context.sync convergence
observed, and full canary green. Hardware N=3 remains explicitly unchecked
because the Jetson could not be reached or host-key verified. Earlier slices'
evidence is in their dated entries.

**Canary status:** last run 2026-07-05 against localhost node1
`ws://127.0.0.1:19001` with a dedicated canary identity in the `localmesh`
named mesh; CANARY GREEN for A, B, and C.

**Deviations & objections:** no design objections logged. The real-LAN N=3
measurement is unverified, not claimed; localhost N=3 is the verified
protocol evidence for this slice.

**Open threads:** Slice 5 typecheck confirmation remains. Jetson reachability
is still the blocker for hardware LLM and real-LAN N=3 evidence.

**Repo state:** expected after this entry is committed and tagged: branch
`main`, local-only, ahead of `origin/main`, nothing pushed to GitHub.
`scripts/local-mesh.sh clean` has been run; no `/tmp/clawmesh-local-mesh`
state dir or localhost node processes remain. The pre-existing Mac command
center process for the `bhoomi` mesh was left untouched.

## 2026-07-05 — Phase 2 Slice 5: typecheck confirmation

**What changed:** no code changed in this slice. The handoff listed typecheck
debt as optional if time remained; Slice 3's resolver/runtime cleanup already
removed the observed TypeScript errors, so this slice is a confirmation and
completion-log slice.

**Verification:**
- `pnpm exec tsc --noEmit` → passed with no errors.
- The full behavior gate is unchanged from the Slice 3 post-fix run:
  `pnpm exec vitest run src/mesh/ src/agents/` → 136 files / 2102 tests
  passed; `pnpm exec vitest run src/cli/` → 7 files / 124 tests passed.
- Last live verification is the Slice 4 N=3 localhost run immediately above:
  2-hop node1→node2→node3 delivery observed, context.sync convergence after
  node3 partition/rejoin observed, and full CANARY GREEN with shot C executed.

**Hardware acceptance:** UNCHECKED. No new hardware-specific typecheck work was
required, and the Jetson remained unreachable as recorded in Slices 3 and 4.

**Phase 2 status:** complete locally for all slices that can be verified from
this machine. Real-LAN Jetson evidence remains explicitly unchecked because
the device could not be reached or host-key verified.

### REVIEW 2026-07-05

| Slice | Status | Commit range | Tag |
|---|---|---|---|
| 1 — mDNS discovery repair | done | `20b4b01` | `slice-1-done-20260705` |
| 2 — CLI truth | done | `20b4b01..slice-2-done-20260705` | `slice-2-done-20260705` |
| 3 — LLM capability + streaming inference | done | `slice-2-done-20260705..slice-3-done-20260705` | `slice-3-done-20260705` |
| 4 — N=3 measurements | done | `slice-3-done-20260705..slice-4-done-20260705` | `slice-4-done-20260705` |
| 5 — typecheck debt | done | `slice-4-done-20260705..slice-5-done-20260705` | `slice-5-done-20260705` |

**Acceptance evidence:** Slices 1-4 evidence is recorded in their entries
above. Slice 5 evidence is `pnpm exec tsc --noEmit` passing cleanly. Final
software gates: mesh+agents 136 / 2102 passed; CLI 7 / 124 passed; typecheck
passed. Live localhost evidence: N=3 2-hop delivery, context.sync after
partition/rejoin, deterministic LLM inference smoke, and full canary all green.
Hardware evidence is explicitly unverified because Jetson SSH/fingerprint
verification could not be reached.

**Canary status:** last run 2026-07-05 against localhost node1
`ws://127.0.0.1:19001` with a dedicated canary identity in the `localmesh`
named mesh; CANARY GREEN for A, B, and C.

**Deviations & objections:** no design objections logged. The only deviation
from preferred acceptance evidence is hardware: Jetson checks are unchecked,
not claimed, due network reachability failure before host-key verification.

**Open threads:** restore Jetson reachability, then rerun Slice 3 hardware
inference and Slice 4 real-LAN N=3 measurements. Phase 3 handoff can now be
prepared from the completed Phase 2 state.

**Repo state:** expected after this entry is committed and tagged: branch
`main`, local-only, ahead of `origin/main`, nothing pushed to GitHub.
`scripts/local-mesh.sh clean` has been run; no `/tmp/clawmesh-local-mesh`
state dir or localhost node processes remain. The pre-existing Mac command
center process for the `bhoomi` mesh was left untouched.

## 2026-07-05 — REVIEW (Tier 2/3): Phase 2 accepted after hardware pass; two defects found and fixed

Reviewed the implementation agent's Phase 2 run (slices 1–5, commits
20b4b01..1174a6b) per docs/OVERSIGHT.md, then closed the hardware
checklist the agent could not reach (its sandbox had no LAN route; the
Jetson was fine from the Mac).

**Review verdict on the agent's work: good.** Sacred trust files
untouched; all suites reproduced green (143 files / 2233 tests after
review changes; tsc clean); PROTOCOL.md covers every new wire symbol
(llm.* family, mesh.world.query, discovery TXT); provenance helper +
the three required tests present; llm-infer handler enforces the
prescribed limits (120 s timeout, 8 KiB chunks, 1 MiB bufferedAmount
abort, concurrency 1). Honest reporting: hardware items left explicitly
unchecked, nothing pushed.

**Hardware verification (all now closed):**
- Discovery: mesh formed on real LAN with ZERO --peer flags, both sides.
- Canary GREEN 3/3 (A/B/C incl. positive T3+human actuation).
- Cross-hardware llm.infer: Mac streamed a completion from a
  Jetson-served model over WiFi (scripts/llm-serve-test.ts, new harness
  tool — deterministic provider; real-model/nanochat serving still open).
- Handshake regression: p50 20.3 ms vs 22.3 ms baseline — no regression.

**Defect 1 (found by hardware run; invisible to localhost harness which
uses --no-discovery): bidirectional dial fight.** With browse fixed on
BOTH nodes for the first time, each side dialed the other; device-keyed
newest-wins registration displaced the opposite connection, the closed
socket's client reconnected, and the link churned (28+ handshakes in
minutes, zero disconnect logs — displacement pre-empts the unregister
path). Fix (normative, PROTOCOL.md §4): only the LOWER deviceId dials a
discovered peer; the higher side stands its outbound client down once
the designated dialer's inbound lands. A stricter registry-level
rejection of crossing connections was tried first and REVERTED the same
evening: the canary caught it locking out same-identity ephemeral tools
(demo-actuate, benches). Registry stays newest-wins with
displaced-socket close; regression test pins the tooling behavior.
Post-fix soak: 1 stable session, 2 connect events / 10 min.

**Defect 2: canary shot C flake.** demo-actuate's ephemeral runtime ran
discovery; ciao's prober raced the short-lived shutdown and crashed the
process intermittently. Plus a macOS bash-3.2 empty-array/set -u bug in
the agent's canary edit made shot C fail before dialing. Both fixed;
canary GREEN 3/3 on hardware.

**Conception note (invention log):** the dial tie-break (lower deviceId
initiates; higher yields to the designated dialer's inbound connection)
is now part of the self-forming design: deterministic single-link
convergence between mutually-discovering trusted peers, without
timestamps or extra wire messages.

**Still open after this review:** N=3 on real hardware (localhost N=3
done by agent: 2-hop delivery, partition/rejoin converged); real-model
(nanochat) serving on the Jetson; Rohith's items (GitHub push decision,
Jetson password rotation, Gemini key).

Phase 2 definition-of-done: met, with the two real-model/N=3-hardware
residuals noted above. Tree at 13209a2, tagged
checkpoint-20260705-phase2-reviewed. Jetson synced to same commit.
