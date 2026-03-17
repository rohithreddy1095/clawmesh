# Autoresearch Ideas Backlog

## High Priority — Production UX
- **TUI mode indicator** — show active/observing/suspended prominently in status bar
- **TUI connection health** — display stale/reconnecting peers  
- **Add --dry-run flag to CLI** — validates config without starting
- **Expose metrics in mesh.health RPC response** — add metrics snapshot to health check result

## Medium Priority — Robustness
- **Peer registry transport abstraction** — replace raw WebSocket refs with Transport interface
- **Context sync on reconnect** — request missing frames when peer reconnects after disconnect

## Lower Priority — Future
- **Structured logger adoption** — replace console.log defaults with MeshLogger across codebase
- **Extract TUI data builders** as pure functions for testing
