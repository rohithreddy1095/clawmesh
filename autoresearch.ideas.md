# Autoresearch Ideas Backlog

## Done ✅ (Sessions 5-6)
- ~~PiSession wiring (9 modules)~~
- ~~Production hardening: retry, error logging, startup validation~~
- ~~ConnectionHealthMonitor + RateLimiter wired into runtime~~

## High Priority — Production UX
- **Wire startup validation into CLI** — run pre-flight checks before `clawmesh start`, show clear report
- **Add --dry-run flag** to CLI — validates config without starting
- **TUI: show connection health** — display stale/reconnecting peers, rate limit status
- **TUI: show mode indicator** — active/observing/suspended prominently in status bar
- **Graceful shutdown signal handling** — SIGTERM/SIGINT cleanup with timeout

## Medium Priority — Robustness
- **Wire ConnectionHealthMonitor periodic checks** — start a timer to run checkAll() every 30s
- **Add peer message size limits** — reject messages > 1MB
- **Pattern memory persistence** — save/load patterns to disk across restarts
- **World model persistence** — snapshot/restore for fast startup

## Lower Priority — Architecture
- **Structured logger adoption**: Replace console.log defaults with MeshLogger
- **Peer registry transport abstraction**: Replace WebSocket refs with Transport interface
- **Extract TUI data builders** as pure functions for testing
