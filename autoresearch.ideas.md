# Autoresearch Ideas Backlog

## High Priority — God Object Below 500
- **Extract WS server setup from start()**: The WebSocketServer creation + connection handler (~40 lines) could become a helper function.
- **Extract stop() cleanup**: stop() teardown logic (~25 lines) could be simplified by delegating to sub-managers.

## Medium Priority — Test Coverage for Large Modules
- **PiSession pure logic tests**: Test buildSystemPrompt(), checkThresholdRule(), mode transitions (active/observing/suspended) without LLM calls.
- **Telegram channel deeper tests**: Mock grammy Bot to test message routing, access control, alert forwarding.
- **CLI option parsing tests**: Test parsePeerSpec(), collectOption(), loadLocalEnvFiles() from clawmesh-cli.ts.

## Lower Priority
- **Structured logger adoption**: Replace console.log across codebase with MeshLogger.
- **Peer registry transport abstraction**: Replace WebSocket refs with Transport interface.
