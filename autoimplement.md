# Autoimplement: Mesh Reliability & Evolution

## Objective
Improve ClawMesh through small, git-tracked, Red/Green TDD slices.

This workflow is modeled after `autoresearch`, but optimized for implementation rather than open-ended architecture exploration. The focus is:

- one narrowly scoped behavior at a time
- failing test first
- smallest green implementation
- immediate git commit after green
- repeat until the milestone is complete

## Current Goal
Strengthen ClawMesh as a real distributed system before adding more intelligence.

Priority themes:
1. peer lifecycle truthfulness
2. stable mesh identity + protocol generation
3. explicit node roles + passive/viewer clients
4. WAN/relay connectivity
5. planner leadership + failover

## Working Rules

### Core TDD loop
For every slice:
1. **Red** — write one failing test for one visible behavior
2. **Green** — implement the smallest change that makes it pass
3. **Refactor** — only if needed after green
4. **Commit** — one git commit per green slice

### Scope discipline
- Never combine unrelated features in one slice
- Prefer manager-level or module-level tests before full runtime/integration tests
- Use the runtime harness for fast local multi-node tests
- Validate on the real Jetson only after local tests are green

### Commit discipline
Commit message shape:
- `test(mesh): ...`
- `feat(mesh): ...`
- `refactor(mesh): ...`

Example:
- `feat(mesh): broadcast graceful peer leaving before shutdown`

## Metrics

### Primary
- **test_count** — total passing tests; must not go down

### Secondary
- **test_files** — test suite breadth
- **source_modules** — modularity growth
- **god_object_lines** — `src/mesh/node-runtime.ts` size; lower is better
- **git_commits_ahead** — implementation slices completed since `origin/main`

## Current Completed Slices

### Foundation
- ✅ Reusable runtime harness for multi-node TDD
  - commit: `da99da2`
  - message: `test(mesh): add reusable runtime harness for multi-node TDD`

### Milestone 1 — Peer lifecycle truthfulness
- ✅ Graceful leave broadcast (`peer.leaving`)
  - commit: `82968a1`
  - message: `feat(mesh): broadcast graceful peer leaving before shutdown`

- ✅ Hard disconnect propagation (`peer.down` broadcast + handling)
  - commit: `8b859e0`
  - message: `feat(mesh): broadcast and handle peer.down on hard disconnect`

- ✅ Reachability confirmation before honoring `peer.down`
  - commit: `53e9c5e`
  - message: `feat(mesh): confirm peer reachability before honoring peer.down`

- ✅ Dead-peer suppression / ghost reconnect prevention
  - commit: `55a0344`
  - message: `feat(mesh): suppress auto-connect for confirmed dead peers`

- ✅ Stable mesh identity (`meshId`) in peer handshake
  - commit: `463e13f`
  - message: `feat(mesh): add stable mesh identity to handshake`

- ✅ Protocol generation (`gen`) on mesh messages
  - commit: `21ca115`
  - message: `feat(mesh): add protocol generation checks to mesh events`

- ✅ Explicit node roles in peer handshake
  - commit: `d410c75`
  - message: `feat(mesh): add explicit node roles to peer handshake`

- ✅ Viewer/passive clients excluded from capability routing
  - commit: `969d8de`
  - message: `feat(mesh): exclude viewer peers from capability routing`

- ✅ Planner election primitive
  - commit: `741e62b`
  - message: `feat(mesh): add deterministic planner election primitive`

- ✅ Expose peer roles in operational RPC/status surfaces
  - commit: `30afe1f`
  - message: `feat(mesh): expose peer roles in mesh status RPCs`

- ✅ Planner leadership observable in health/runtime surfaces
  - commit: `a48c45a`
  - message: `feat(mesh): surface planner leadership in health status`

- ✅ CLI support for mesh role / mesh name
  - commit: pending
  - message: `feat(cli): add runtime role and mesh name options`

## Next Planned Slice

### Red/Green target
**Planner activity gating**

Desired behavior:
- expose whether the local node should be considered active or standby based on planner election
- keep the first step observational or minimally enforced
- foundation for duplicate-proposal prevention in multi-planner meshes

This is the next practical HA slice.

## Milestone Plan

### Milestone 1 — Peer lifecycle truthfulness
- ✅ runtime harness
- ✅ `peer.leaving`
- ✅ `peer.down` broadcast/handling
- ✅ reachability confirmation before removal
- ✅ dead-peer suppression / ghost reconnect prevention

### Milestone 2 — Identity & protocol safety
- ✅ `meshId`
- ✅ protocol generation / version field
- ✅ reject mismatched mesh IDs
- ✅ reject unsupported generations

### Milestone 3 — Role separation
- explicit node roles
- passive/viewer clients
- routing restrictions by role

### Milestone 4 — WAN connectivity
- relay-backed connection mode
- preserve LAN/mDNS path
- trust behavior unchanged across transport

### Milestone 5 — Planner HA
- planner election
- standby promotion
- sticky planner sessions
- no duplicate proposal generation

## Files in Scope
- `src/mesh/`
- `src/agents/` (only when planner leadership/failover work begins)
- `src/cli/` (only when role/mesh-id/relay flags are added)

## Constraints
- All existing tests must stay green
- No new npm dependencies unless explicitly justified
- Backward compatible where possible
- Real Jetson validation happens after local green, not instead of it

## How to Run
- `./autoimplement.sh` — prints implementation metrics
- `./autoimplement.checks.sh` — runs guardrail checks before/after a slice

## Notes
The goal is not to turn ClawMesh into mesh-llm.
The goal is to borrow distributed-systems discipline from mesh-llm while preserving ClawMesh's core strengths:
- trust-gated actuation
- world model
- capability routing
- farm digital twin
- human-in-the-loop proposal flow
