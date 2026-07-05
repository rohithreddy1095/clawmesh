# CLAUDE.md — ClawMesh

## Vision

ClawMesh is "Bluetooth for agents and hardware": a self-forming, trust-gated mesh
where heterogeneous devices (laptop, Jetson, sensors, actuators, GPU boxes) pair
explicitly, advertise capabilities, share emergent context, and eventually pool
compute so local inference can run across connected hardware.

## The contribution claim (candidate patent technique)

The defensible novelty is NOT any single mechanism (mDNS discovery, Ed25519
pairing, gossip, capability routing all have prior art). It is the composition:

> **Evidence provenance as first-class wire metadata that gates physical
> actuation in a self-forming device mesh.** Every context frame carries an
> evidence trust tier (T0 planning inference → T3 verified action evidence);
> actuation paths enforce tier + approval level (L0–L3) on both sender and
> receiver; LLM-only evidence (T0) is hard-blocked from physical actuation at
> the protocol level, not as an application convention.

Prior art to position against (and differentiate from) in any spec, paper, or
patent filing: Google A2A, MCP, ROS 2 / SROS2 / DDS, Tailscale-style device
identity, epidemic gossip protocols, exo/petals for distributed inference.

**IP hygiene until filing:**
- Treat the tier-gated actuation mechanism as the core technique. Do not
  describe it as "standard practice" in docs or commit messages.
- Keep an invention log: date-stamped notes for design decisions on the
  technique (docs/ or a private log), since filing will need conception dates.
- Note: public repo activity may constitute prior disclosure in
  absolute-novelty jurisdictions. Rohith should confirm repo visibility
  strategy with patent counsel before publishing a formal spec. (Claude is
  not a lawyer; this is a flag, not legal advice.)

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

`docs/HANDOFF-2026-07-05-inference-phase.md` — Phase 2: fix mDNS discovery
(self-forming must be true), inference as a mesh capability
(`llm:<provider/model>` advert + streaming `llm.infer` RPC with T0
provenance surviving forwarding), N=3 measurements. Design decisions are
pre-made in the handoff; spec-first, Red/Green. Start there.

(Phase 1 — first real deployment — completed 2026-07-05; see engineering
log. The old deploy handoff is gitignored and pending deletion once Rohith
rotates the Jetson password.)

## Keeping this file current

This file holds durable truths: vision, contribution claim, role, conventions.
Fast-moving state lives in `docs/ENGINEERING-LOG.md` — a date-stamped,
append-only log that doubles as the invention log for the patent filing.
Claude appends a log entry whenever a session produces a decision, milestone,
or status change, and updates this file only when direction itself changes.

## Working conventions

- Small, test-backed slices; mesh reliability changes developed Red/Green.
- Never weaken trust/safety constraints casually — the tier-gating is the IP.
- Tests should be risk-driven, not count-driven; consolidate, don't pad.
- WAN/static behavior stays explicit and operator-visible.
- UI reflects backend truth, never mock state.

## Commands

```bash
pnpm install && pnpm typecheck && pnpm test   # full check
pnpm exec tsx clawmesh.ts <command>            # run from source
pnpm exec vitest run src/mesh/                 # targeted tests
```
