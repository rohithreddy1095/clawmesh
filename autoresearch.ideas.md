# Autoresearch Ideas Backlog

## High Priority — PiSession Reduction (765 → ~600)
- **Extract buildSystemPrompt()** from PiSession — pure function, easy to test independently
- **Extract broadcastAgentResponse()** — helper function, no state needed
- **Extract handleSessionEvent()** — event classifier already extracted, wire it
- **Extract runCycle prompt construction** — the operator vs system trigger prompt logic is ~60 lines of pure string building

## Medium Priority — Structural Improvements
- **Wire SessionEventClassifier into PiSession** — replace inline handleSessionEvent with extracted classifier.
- **Wire PlannerPromptBuilder into PiSession** — replace buildSystemPrompt() and runCycle prompt construction.
- **Extract WS server setup from start()**: The WebSocketServer creation + connection handler (~40 lines) could become a helper function.

## Lower Priority — Coverage & Quality
- **TUI rendering tests**: Extract buildPeersColumn/buildGossipColumn data logic from ANSI formatting.
- **Structured logger adoption**: Replace console.log across codebase with MeshLogger.
- **Peer registry transport abstraction**: Replace WebSocket refs with Transport interface.
- **Extract stop() cleanup**: stop() teardown logic (~25 lines) could be simplified by delegating to sub-managers.
