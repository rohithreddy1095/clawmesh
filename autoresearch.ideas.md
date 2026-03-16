# Autoresearch Ideas Backlog

## High Priority — God Object Decomposition
These wire the new modules into node-runtime.ts and actually reduce its size:

- **Wire RpcDispatcher into node-runtime**: Replace inline dispatchRpcRequest method with the extracted RpcDispatcher. Reduces node-runtime.ts by ~40 lines.
- **Wire UIBroadcaster into node-runtime**: Replace the inline uiSubscribers Set + broadcastToUI method with the extracted UIBroadcaster. Reduces ~20 lines.
- **Wire IntentRouter into node-runtime**: Replace the 50-line inline intelligence handler block in handleInboundMessage with extractIntentFromForward + routeIntent. Reduces ~50 lines.
- **Wire TriggerQueue into PiSession**: Replace pendingTriggers[] with the new TriggerQueue. Modifies pi-session.ts, adds proper priority + dedup.
- **Wire context sync into peer-client**: On peer connection, send context.sync request. ~20 lines in peer-client.ts.

## Medium Priority — Intelligence Improvements  
- **World model summarize() in planner**: Use model.summarize() in the before_agent_start hook to produce better LLM context instead of raw frame dumps.
- **Pattern decay**: Add time-based confidence decay to patterns that haven't been reinforced recently.

## Lower Priority — Operational
- **Structured logger adoption**: Replace console.log calls across the codebase with MeshLogger instances.
- **Wire auto-connect into discovery**: When MeshDiscovery emits peer-discovered, run AutoConnectManager.evaluateWithTrust and connect if approved.
