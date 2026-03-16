# Autoresearch Ideas Backlog

## High Priority — Remaining Extractions
- **Extract start/stop lifecycle from node-runtime**: MeshNodeRuntime.start() (~90 lines) and stop() (~30 lines) do WS server setup, mDNS init, planner init, peer connection — could extract WebSocket server lifecycle into a module.
- **Extract peer connection management**: connectToPeer + outboundClients map (~50 lines) could become PeerConnectionManager.

## Medium Priority — Test Coverage Gaps
- **peer-client.ts tests** (232L, 0 tests): Outbound WebSocket connection with reconnect backoff — test reconnect, handshake, TLS pinning logic.
- **gateway-connect.ts tests** (199L, 0 tests): Remote gateway connection with auth.
- **Telegram channel deeper tests**: Only 5 tests for 701 lines — could add mock bot tests.

## Lower Priority — Quality
- **Structured logger adoption**: Replace console.log across codebase with MeshLogger.
- **Peer registry transport abstraction**: Replace WebSocket refs with Transport interface.
- **Inbound peer auto-connect tracking**: Only outbound peers tracked in AutoConnectManager.

## Completed ✅ (pruned — see autoresearch.md for full history)
All Phase 1-3 items, all wiring, all module extractions from sessions 1-3.
