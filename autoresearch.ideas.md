# Autoresearch Ideas Backlog

## Completed ✅
- ✅ Wire RpcDispatcher into node-runtime (god object -80 lines)
- ✅ Wire UIBroadcaster into node-runtime (god object -7 lines)
- ✅ Wire IntentRouter into node-runtime (god object -47 lines)
- ✅ Wire TriggerQueue into PiSession (replaces pendingTriggers[])
- ✅ Wire AutoConnect into discovery pipeline
- ✅ Wire TrustAuditTrail into trust evaluation
- ✅ Wire world model summarize() into planner hook
- ✅ Trust audit trail module

## Medium Priority — Still To Do
- **Wire context sync into peer-client**: On peer connection, send context.sync request. ~20 lines in peer-client.ts.
- **Structured logger adoption**: Replace console.log calls across the codebase with MeshLogger instances.
- **Pattern decay**: Add time-based confidence decay to patterns that haven't been reinforced recently.
- **Wire auto-connect markConnected for inbound peers**: Currently only outbound peers track state.

## Lower Priority
- **Capability health tracking**: Wire structured capability health updates into the registry.
- **World model TTL auto-eviction**: Add periodic eviction timer to WorldModel.
- **Peer registry transport abstraction**: Replace WebSocket refs with Transport interface in PeerSession.
