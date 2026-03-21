# Autoresearch Ideas Backlog

## High Priority — System Design
- **Handshake replay protection** — nonce challenge-response to close 5-min replay window
- **Proposal context in TUI** — show ProposalContext when operator views a proposal
- **Proposal context in Telegram** — enrich proposal notifications with current sensor data

## Medium Priority — Observability
- **TUI: event log tail** — `events` command to show recent system events
- **TUI: data freshness indicators** — mark stale readings in gossip column
- **CLI: add `clawmesh events` command** — query mesh.events RPC

## Lower Priority — Architecture
- **God object reduction** — extract PiSession startup/wiring from node-runtime
- **Peer registry transport abstraction** — replace raw WebSocket refs
- **Structured logger adoption** — replace console.log defaults with MeshLogger
