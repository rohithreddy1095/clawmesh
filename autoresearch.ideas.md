# Autoresearch Ideas Backlog

## Deferred for later
- **Wire event bus into node-runtime**: The MeshEventBus exists but isn't yet wired into MeshNodeRuntime. This is the big integration step — replace onIngest callback with bus.emit, replace broadcastToUI with bus.emit("ui.broadcast"), etc. Requires careful refactoring of node-runtime.ts.
- **Wire TriggerQueue into PiSession**: Replace pendingTriggers[] with the new TriggerQueue. Requires modifying pi-session.ts.
- **Wire RpcDispatcher into node-runtime**: Replace the inline dispatchRpcRequest method with the extracted RpcDispatcher. Reduces node-runtime.ts by ~40 lines.
- **Wire health check into node-runtime**: Register the mesh.health RPC handler. ~5 lines of wiring.
- **Wire context sync into peer-client**: On peer connection, send context.sync request. ~20 lines.
- **Structured logger adoption**: Replace console.log calls across the codebase with MeshLogger instances.
- **Trust audit trail**: Log every trust evaluation decision to a persistent audit log for compliance/debugging.
- **Capability versioning**: Evolve flat capability strings to structured objects with version, params, health.
- **World model summarize() in planner**: Use model.summarize() in the before_agent_start hook to produce better LLM context.
- **Pattern decay**: Add time-based confidence decay to patterns that haven't been reinforced recently.
