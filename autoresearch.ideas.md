# Autoresearch Ideas Backlog

## High Priority — Security
- **Handshake nonce challenge-response** — close the 5-min replay window in mesh.connect

## Medium Priority — Production Robustness
- **God object reduction** — extract PiSession startup wiring from node-runtime (~30 lines)
- **Wire CorrelationTracker** into runtime — trace sensor→threshold→proposal→execute chains live
- **Peer registry transport abstraction** — replace raw WebSocket refs with Transport interface

## Lower Priority
- **Structured logger adoption** — replace console.log defaults with MeshLogger
- **TUI data freshness indicators** — mark stale readings in gossip column
