# OVERSIGHT.md — progressive check-and-heal protocol for long-running agent work

Purpose: Rohith runs implementation agents against the phase handoffs for
long stretches. This file defines the checkpoints that catch drift early
and the healing actions when a check fails. Review sessions (strongest
available model) should be pointed at this file; implementation agents
only need to know it exists and must never edit it.

The end state being protected: a trust-gated, self-forming mesh where
provenance gates actuation at the protocol level — and where every claim
in the docs is something the wire actually does.

## Checkpoint mechanics

Tag the tree at every review so drift is diffable:

```bash
git tag checkpoint-$(date +%Y%m%d-%H%M)   # at the END of each review
git diff <last-checkpoint>..HEAD --stat   # at the START of the next
```

## Tier 1 — per agent session (automated gate, no human)

The session prompt already requires these; spot-check that they happened:

- [ ] `pnpm exec vitest run src/mesh/ src/agents/` fully green.
- [ ] A dated entry appended to `docs/ENGINEERING-LOG.md` for the session.
- [ ] Commits are small and scoped to one slice; messages name the slice.
- [ ] `git status -sb` — main pushed to origin (authorized by Rohith
      2026-07-07); no force-pushes, no stray remote branches.

## Tier 2 — per completed slice (~15 min, Rohith or a review session)

1. **Acceptance, not vibes:** open the slice's acceptance criteria in the
   active handoff and check each item literally. "Tests pass" is not
   acceptance; the hardware verification line matters most — agents
   without LAN access must have left it explicitly unchecked, not claimed.
2. **Sacred-file diff:** any change to these files gets read line by line:
   `src/mesh/trust-policy.ts`, `src/mesh/mock-actuator.ts`,
   `src/mesh/handshake.ts`, `src/mesh/challenge-store.ts`,
   `src/mesh/command-envelope.ts`.
   Red flags: a tier check relaxed "temporarily", a new code path that
   reaches an actuator without passing `evaluateMeshForwardTrust`, trust
   metadata defaulted to permissive values, a test deleted or weakened to
   make an implementation fit.
3. **Decision fidelity:** skim the diff against the handoff's "decisions
   (do not reopen)" list — library swaps, renamed RPC methods, changed
   error codes, or "simplified" trust labeling mean the agent redesigned.
4. **Spec sync:** every new wire-visible method/event/error appears in
   PROTOCOL.md in the same or an earlier commit:
   ```bash
   git diff <checkpoint> -- src/mesh | grep -oE '"(mesh|llm|context|clawmesh|chat)\.[a-z.]+"' | sort -u
   # each hit must be findable in PROTOCOL.md
   ```

## Tier 3 — weekly (or every ~3 slices): live health + safety canary

Run against the real mesh (boot commands are in the active handoff).

1. **Mesh smoke:** `mesh.peers` from both sides shows the other; frames
   flowing (world model count increasing); UI reflects it.
2. **Safety canary — the three-shot live-fire.** This is the IP; it must
   behave identically forever, regardless of what shipped that week:
   ```bash
   scripts/safety-canary.sh ws://<jetson-ip>:18789 <jetsonDeviceId>
   ```
   (mis-declared → `ACTUATION_DECLARATION_REQUIRED`; LLM-only →
   `LLM_ONLY_ACTUATION_BLOCKED`; T3+human → executes. Run
   `demo-actuate --llm-only` separately for the sender-side check.)
   After Phase 2 Slice 3 lands, extend the script with shot D: an
   `llm.infer` result forwarded toward an actuator is rejected — from a
   REMOTE node. CANARY RED: stop all agent work, `git bisect` with the
   canary as the test, revert, log the incident.
3. **Measurement regression:**
   `pnpm exec tsx scripts/handshake-bench.ts ws://<jetson-ip>:18789 20` —
   baseline p50 22.3 ms (2026-07-05). >2× regression = investigate before
   merging more work. Frame flow: `node scripts/frame-listen.mjs`.
   No hardware handy? `scripts/local-mesh.sh up 3` gives a full localhost
   mesh (see scripts/README.md) — valid for protocol checks, not a
   substitute for the real-LAN runs the handoff requires.
4. **IP hygiene sweep:** log entries dated and appended (never edited);
   no doc/commit language calling the tier-gating "standard practice";
   pushes limited to origin/main + tags (authorized 2026-07-07); no
   force-pushes or history rewrites without Rohith.
5. **Repo hygiene:** stray branches merged or deleted on both machines;
   Jetson clone fast-forwarded to Mac main; no stashes silently dropped.

## Phase gate (before starting the next phase's handoff)

- [ ] Every item in the current handoff's "Definition of done" checked
      against the live mesh, not against test output.
- [ ] Full suite green including any new provenance/pairing tests.
- [ ] PROTOCOL.md readable as a standalone spec for everything shipped
      (the reimplementability test: could a stranger build a compatible
      node without reading the TS?).
- [ ] Engineering log tells a continuous dated story of the phase.
- [ ] Next phase's handoff written in the same discipline: decisions
      pre-made, slices ordered, acceptance criteria, traps carried
      forward. Written by the strongest available model, reviewed by
      Rohith before any agent sees it.

## Healing actions (match failure → response)

| Failure found | Healing action |
|---|---|
| Suite red / canary wrong | Stop agents. Bisect, revert to last green checkpoint tag, log incident + root cause in the engineering log. |
| Trust gate weakened | Revert immediately (never "fix forward" on the gate). The reverted diff becomes a required-rejection test case. |
| Agent redesigned a pre-made decision | Revert the redesign. Re-run the slice with the decision quoted verbatim in the prompt and an explicit "this was reverted once" note. |
| Wire change without spec | Freeze feature work; PROTOCOL.md section written and reviewed before anything further merges. |
| Acceptance claimed but hardware step not run | Treat the slice as open. Re-verify on hardware before the next slice starts; note the false claim in the log (calibration data for how much to trust that agent's reports). |
| Hallucinated APIs / deps that don't exist | Revert, pin the correct API in the handoff's decisions list so the next attempt can't re-invent it. |
| Long session drifting / thrashing | Kill it. Start a FRESH session from the standard prompt — handoff + log carry all needed state; a confused context does not. |
| Mesh state broken (zombie peers, mesh-id mismatch) | Restart nodes with the boot commands in the handoff; check "Known traps" before debugging deeper. |

## Division of labor

- **Implementation agents (earlier models):** execute slices exactly as
  specified. May propose changes only as log notes, never as code.
- **Review sessions (strongest model):** Tier 2/3 checkpoints, phase
  gates, writing the next handoff, editing this file.
- **Rohith only:** repo visibility changes, force-pushes/history
  rewrites, credentials/keys, patent-counsel
  questions, anything under "Ask Rohith" in the active handoff.
