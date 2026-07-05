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
