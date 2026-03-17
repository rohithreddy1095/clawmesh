# Autoresearch Ideas Backlog

## High Priority — Production UX
- **Wire startup validation into CLI** — run pre-flight checks before `clawmesh start`, show clear report
- **Wire GracefulShutdown into CLI** — install signal handlers in the `start` command
- **Wire MetricsCollector into runtime** — increment counters on message receive/rate-limit/frame ingest
- **Wire ConnectionHealthMonitor periodic timer** — run checkAll() every 30s, emit peer.stale events

## Medium Priority — Robustness
- **Pattern memory persistence** — save/load patterns to disk across restarts
- **World model persistence** — snapshot/restore recent frames for fast startup
- **Peer registry transport abstraction** — replace raw WebSocket refs with Transport interface

## Lower Priority — Future
- **Structured logger adoption** — replace console.log defaults with MeshLogger across codebase
- **Extract TUI data builders** as pure functions
