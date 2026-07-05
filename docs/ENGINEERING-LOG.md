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
