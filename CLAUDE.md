# CLAUDE.md — ClawMesh

## Vision

ClawMesh is "Bluetooth for agents and hardware": a self-forming, trust-gated mesh
where heterogeneous devices (laptop, Jetson, sensors, actuators, GPU boxes) pair
explicitly, advertise capabilities, share emergent context, and eventually pool
compute so local inference can run across connected hardware.

## The core design invariant

What makes ClawMesh different from adjacent systems (agent protocols,
robot middleware, device-identity overlays) is one composition, enforced
on the wire rather than by application convention:

> **Evidence provenance as first-class wire metadata that gates physical
> actuation in a self-forming device mesh.** Every context frame carries an
> evidence trust tier (T0 planning inference → T3 verified action evidence);
> actuation paths enforce tier + approval level (L0–L3) on sender, receiver
> gate, and executor independently; LLM-only evidence (T0) is hard-blocked
> from physical actuation at the protocol level. Provenance survives
> capability forwarding: inference produced on another node stays T0 across
> any number of hops.

This invariant outranks every feature. Never weaken it — not temporarily,
not behind a flag, not to make a test pass. Design decisions that touch it
get date-stamped notes in `docs/private/` (gitignored; maintained by
review sessions).

## Claude's role

Pragmatic research engineer. Factual to the bit level. Priorities in order:
correctness of the protocol, measurable claims, then features. Push back on
vanity metrics (test-count-driven test files) and unmeasured claims. When the
mesh framing implies guarantees the wire doesn't provide (backpressure, ordering,
convergence), say so plainly.

## Engineering direction (agreed 2026-07-05)

1. **Fix the handshake payload ambiguity** — `buildMeshAuthPayload` joins
   optional fields with `|` and skips absent ones, so `{nonce:"x"}` and
   `{meshId:"x"}` sign identical strings. Move to fixed-position fields with
   explicit empty markers; make server-issued nonce mandatory (replay window
   is otherwise 5 min).
2. **Write PROTOCOL.md** — versioned wire spec (envelope, frame schema,
   handshake sequence, error codes) reimplementable without reading the TS.
   The protocol is the product; today it is implicit across files.
3. **Measurements** — frame propagation latency at N nodes, partition/rejoin
   behavior (anti-entropy exists via `context.sync` but is single-shot and
   capped at 500 frames / 1 h lookback — convergence is bounded, not
   guaranteed), handshake overhead. Research claims require numbers.
4. **Inference as a mesh capability** — advertise `llm:<model>` from nodes,
   inference-forwarding RPC with streaming, so a planner uses a peer's model.
   This is the bridge from "control plane" to the distributed-inference vision.
   True split-model inference is a separate problem; prefer integrating an
   existing engine (exo-style) over building one.
5. **Keep core generic** — the Bhoomi farm vertical (`farm/`, twin UI) is the
   driving use case, not the product. Don't let farm assumptions ossify the
   mesh core.

## Known wire-level realities (be honest in docs)

- JSON strings over WebSocket; no binary framing, compression, backpressure
  (`bufferedAmount` unchecked), or message-level ack/retry.
- Gossip: flood with hop-limit 3 + seen-set dedup; wall-clock timestamps, no
  logical clocks. Anti-entropy is `context.sync` on outbound connect only
  (single-shot, ≤500 frames, 1 h lookback) — bounded convergence. Fine for
  2–10 node LAN control plane; not a data plane for token streams or camera
  frames. Full wire contract: PROTOCOL.md.

## Active handoff

`docs/HANDOFF-2026-07-06-boot-to-mesh.md` — Phase 3: node config file,
known-meshes store, human-confirmed pairing ceremony (SAS), operator RPC
auth tiers, service lifecycle. All five slices localhost-verifiable;
hardware appendix reserved for review sessions. Decisions pre-made;
spec-first, Red/Green. Start there.

(Phase 1 deployed and Phase 2 reviewed/accepted 2026-07-05 — see
engineering log, tag `checkpoint-20260705-phase2-reviewed`. The Phase-1
deploy handoff is gitignored, pending deletion once Rohith rotates the
Jetson password.)

## Keeping this file current

This file holds durable truths: vision, core invariant, role, conventions.
Fast-moving state lives in `docs/ENGINEERING-LOG.md` — a date-stamped,
append-only technical log. Claude appends a log entry whenever a session
produces a decision, milestone, or status change, and updates this file
only when direction itself changes. Notes on invariant-touching design
decisions additionally go to `docs/private/` (gitignored, review sessions
only).

## Working conventions

- Small, test-backed slices; mesh reliability changes developed Red/Green.
- Never weaken trust/safety constraints casually — the tier-gating is the
  core of the system.
- Tests should be risk-driven, not count-driven; consolidate, don't pad.
- WAN/static behavior stays explicit and operator-visible.
- UI reflects backend truth, never mock state.

## Commands

```bash
pnpm install && pnpm typecheck && pnpm test   # full check
pnpm exec tsx clawmesh.ts <command>            # run from source
pnpm exec vitest run src/mesh/                 # targeted tests
```
