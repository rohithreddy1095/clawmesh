# Autoresearch Ideas Backlog

## High Priority — God Object Below 500
- **Extract chat RPC handlers** from constructor: chat.subscribe, chat.proposal.approve/reject (~40 lines) → `createChatHandlers()` factory
- **Extract WS server setup from start()**: The WebSocketServer creation + connection handler (~40 lines) could become a helper function.
- **Extract stop() cleanup**: stop() teardown logic (~25 lines) could be simplified by delegating to sub-managers.

## Medium Priority — Structural Improvements
- **Wire ModeController into PiSession** — replace inline mode logic with the extracted ModeController class.
- **Wire ProposalManager into PiSession** — replace inline proposal maps with ProposalManager.
- **Wire FrameIngestor into PiSession** — replace inline handleIncomingFrame with FrameIngestor functions.

## Lower Priority — Coverage & Quality
- **TUI rendering tests**: Extract buildPeersColumn/buildGossipColumn data logic from ANSI formatting.
- **Structured logger adoption**: Replace console.log across codebase with MeshLogger.
- **Peer registry transport abstraction**: Replace WebSocket refs with Transport interface.
