# Autoresearch Ideas Backlog

## High Priority — God Object Below 500
- **Extract WS server setup from start()**: The WebSocketServer creation + connection handler (~40 lines) could become a helper function.
- **Extract stop() cleanup**: stop() teardown logic (~25 lines) could be simplified by delegating to sub-managers.
- **Extract chat RPC handlers** from constructor: chat.subscribe, chat.proposal.approve/reject (~40 lines)

## Medium Priority — More Module Extraction
- **Extract GossipController** — pattern gossip logic from PiSession (gossipPatternsIfReady, handleIncomingFrame)
- **Extract FrameIngestor** — handleIncomingFrame threshold checking + pattern import logic
- **Extract PeerEventHandler** — socket close/error handling from node-runtime start()

## Lower Priority — Coverage Expansion
- **Structured logger adoption**: Replace console.log across codebase with MeshLogger.
- **Peer registry transport abstraction**: Replace WebSocket refs with Transport interface.
- **TUI rendering tests**: Extract buildPeersColumn/buildGossipColumn data logic from ANSI formatting.
