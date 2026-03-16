# Autoresearch Ideas Backlog

## Medium Priority — God Object Reduction
- **Extract peer lifecycle from node-runtime**: The onConnected/onDisconnected callbacks + connectToPeer logic (~80 lines) could become a PeerLifecycleManager. Would reduce god object further.
- **Extract start/stop lifecycle**: MeshNodeRuntime.start() and stop() contain WS server setup, mDNS init, planner init — could split into separate bootstrap module.
- **Wire auto-connect markConnected for inbound peers**: Currently only outbound peers track state in AutoConnectManager.

## Medium Priority — Architecture Quality
- **Peer registry transport abstraction**: Replace raw WebSocket refs in PeerSession with Transport interface. Unlocks testability for PeerRegistry without real sockets.
- **Structured logger adoption**: Replace console.log calls in node-runtime, peer-client, pi-session with MeshLogger instances — correlation IDs per peer.
- **Capability health tracking**: Wire structured capability health updates into the registry on peer heartbeat/disconnect.

## Lower Priority — Stretch Goals
- **Mesh TUI test coverage**: mesh-tui.ts (599 lines) has no tests.
- **Telegram channel test expansion**: Only 5 tests currently for a 701-line module.
- **CLI command tests**: clawmesh-cli.ts (822 lines) has no direct unit tests.
