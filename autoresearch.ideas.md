# Autoresearch Ideas Backlog

## Done ✅ (Session 5)
- ~~Wire ModeController, ProposalManager, FrameIngestor into PiSession~~
- ~~Wire SessionEventClassifier, PlannerPromptBuilder into PiSession~~
- ~~Wire SystemPromptBuilder, parseModelSpec into PiSession~~
- ~~Extract + wire broadcast helpers (buildAgentResponseFrame, gossip, errors)~~
- ~~TUI data helper tests~~
- ~~Mesh extension integration tests~~

## Medium Priority — Further Decomposition
- **Extract WS server setup from node-runtime start()**: The WebSocketServer creation + connection handler (~40 lines) could become a helper function.
- **Extract PiSession.start() setup**: Resource loader configuration is ~30 lines of pure setup.
- **Extract runCycle LLM response handling**: The success/error branching after session.prompt() is ~50 lines that could be a pure handler.

## Lower Priority — Coverage & Quality
- **Structured logger adoption**: Replace console.log across codebase with MeshLogger.
- **Peer registry transport abstraction**: Replace WebSocket refs with Transport interface.
- **Extract TUI buildPeersColumn/buildGossipColumn** as pure data functions.
- **Farm context schema validation**: Type-safe loading with zod or manual validation.
