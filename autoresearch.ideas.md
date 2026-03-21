# Autoresearch Ideas Backlog

## High Priority — System Design Gaps
- **Expose SystemEventLog via mesh.events RPC** — let remote nodes query event history
- **Wire ProposalDedup into PiSession/extension** — currently module exists but isn't used in runtime
- **Wire proposal expiry sweep into proactive timer** — ✅ DONE (wired in pi-session.ts)
- **Handshake replay protection** — nonce challenge-response to prevent 5-min replay window

## Medium Priority — UX & Observability
- **TUI: show event log tail** — add `events` command to TUI to show recent system events
- **TUI: show data freshness** — mark stale sensor readings in gossip column
- **CLI: add `clawmesh status` command** — queries mesh.health from a running node

## Lower Priority — Architecture
- **Peer registry transport abstraction** — replace raw WebSocket refs with Transport interface
- **Structured logger adoption** — replace console.log defaults with MeshLogger
- **God object reduction** — extract snapshot wiring + event log wiring from node-runtime into setup helpers
