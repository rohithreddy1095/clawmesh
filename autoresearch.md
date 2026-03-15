# Autoresearch: Architecture Hardening

## Objective
Improve ClawMesh's foundational architecture by decomposing the god object, adding an event bus for loose coupling, implementing transport abstractions, adding context sync, and improving the world model — all while keeping existing 135 tests green and growing the test suite for new modules.

The architecture analysis at `docs/architecture-analysis.html` documents the full plan with 10 improvements across 3 phases. We follow that plan.

## Metrics
- **Primary**: `test_count` (number, higher is better) — as we refactor and add modules, new tests prove correctness
- **Secondary**:
  - `god_object_lines` — lines in `src/mesh/node-runtime.ts` (lower = better decomposition)
  - `source_modules` — count of non-test `.ts` files in `src/` (higher = better separation)
  - `test_files` — count of `.test.ts` files in `src/`

## How to Run
`./autoresearch.sh` — outputs `METRIC name=number` lines.

## Files in Scope
All files under `src/` are in scope. Specifically:

### Core refactor targets
- `src/mesh/node-runtime.ts` (754L) — GOD OBJECT. Decompose into focused modules
- `src/mesh/peer-registry.ts` (176L) — Add transport abstraction
- `src/mesh/world-model.ts` (127L) — Add intelligence (TTL, relevance, summarize)
- `src/mesh/capabilities.ts` (~80L) — Evolve to structured capabilities
- `src/mesh/context-propagator.ts` (181L) — Add context sync protocol
- `src/agents/pi-session.ts` (914L) — Priority trigger queue
- `src/agents/pattern-memory.ts` (255L) — CRDT merge fix

### New modules to create
- `src/mesh/event-bus.ts` — Typed EventEmitter for decoupling
- `src/mesh/rpc-dispatcher.ts` — Extract RPC routing from node-runtime
- `src/mesh/intent-router.ts` — Extract intelligence routing
- `src/mesh/ui-broadcaster.ts` — Extract UI subscriber management
- `src/mesh/transport.ts` — Transport abstraction interface
- `src/mesh/context-sync.ts` — Context catch-up protocol

### Test files to create
- Tests for each new module above

## Off Limits
- `ui/` — Web UI is separate concern
- `farm/` — Farm data files
- `.pi/` — Agent skills
- `docs/` — Documentation (except updating architecture-analysis.html)
- External dependencies — no new npm packages
- Test infrastructure — `vitest.config.ts`, `tsconfig.json` structure

## Constraints
- **All 135 existing tests MUST pass** after every change
- **No new npm dependencies** — use Node.js built-ins and existing deps
- **Backward compatible** — MeshNodeRuntime public API must not break
- **Types must compile** (except pre-existing 3 errors in discovery.ts)
- Each change should be small, focused, and independently testable

## Improvement Plan (from architecture analysis)
### Phase 1: Foundation Hardening
1. ✅ Extract MeshEventBus with typed events
2. Decompose MeshNodeRuntime into focused modules
3. Add transport abstraction to PeerRegistry
4. Add context sync/catch-up protocol

### Phase 2: Intelligence Layer
5. Add relevance-scored world model queries
6. Implement priority trigger queue with dedup
7. Fix pattern memory merge with CRDT counters
8. Add world model summarization for LLM context

### Phase 3: Operational Excellence
9. Structured JSON logging with correlation IDs
10. Health check RPC endpoint
11. Discovery → auto-connect for trusted peers
12. Capability negotiation with health-aware routing

## What's Been Tried

### Phase 1: Foundation Hardening ✅
1. ✅ **MeshEventBus** — Typed EventEmitter with 12 event types, cleanup returns, once(), 16 tests
2. ✅ **Transport Abstraction** — Transport interface, WebSocketTransport adapter, MockTransport, 11 tests
3. ✅ **Context Sync Protocol** — Anti-entropy sync handler, client, calculateSyncSince, 15 tests
4. ✅ **RPC Dispatcher** — Extracted from node-runtime, method routing, parse/validate, 22 tests

### Phase 2: Intelligence Layer ✅
5. ✅ **Intelligent WorldModel** — Relevance scoring, TTL eviction, zone-grouped summarize(), 21 tests
6. ✅ **Priority TriggerQueue** — Priority ordering, dedup by metric+zone, max size eviction, 21 tests
7. ✅ **CRDT PatternMemory** — Per-source counters, grow-only CRDT merge, 16 tests

### Phase 3: Operational Excellence ✅
8. ✅ **Structured MeshLogger** — JSON/human output, levels, correlation IDs, child loggers, 15 tests
9. ✅ **Health Check RPC** — computeHealthCheck, degraded detection, mesh.health handler, 13 tests
10. ✅ **Auto-Connect Manager** — Discovery→trust→connect pipeline, rate limiting, 11 tests
11. ✅ **Context Sync RPC Handler** — Server-side context.sync with filters, 5 tests
12. ✅ **Integration Wiring** — Event bus, health check, context sync wired into node-runtime, 11 integration tests

### Additional Improvements
13. ✅ **ContextPropagator test suite** — broadcast, handleInbound, dedup, hop limiting, gossip routing (13 tests)
14. ✅ **MockSensor test suite** — drying pattern, status transitions, stop/idempotent (7 tests)
15. ✅ **MockActuator test suite** — start/stop/set, channel filtering, history trimming (12 tests)
16. ✅ **FarmContextLoader test suite** — real YAML data loading, zones, assets, safety rules (8 tests)
17. ✅ **GatewayConfig test suite** — CRUD, corrupt JSON, invalid entry filtering (8 tests)
18. ✅ **IntentRouter extraction** — extractIntentFromForward, routeIntent with planner/mock (10 tests)
19. ✅ **UIBroadcaster extraction** — subscriber management, auto-cleanup, send failure (9 tests)
20. ✅ **Structured Capabilities** — parseCapabilityString, matchCapability, scoreCapability (19 tests)
21. ✅ **DeviceIdentity test suite** — keygen, sign/verify, base64url, deviceId derivation (13 tests)

22. ✅ **Trust Audit Trail** — decision recording, queryable, statistics with rejection breakdowns (11 tests)
23. ✅ **System Flow Tests** — end-to-end scenarios validating full architecture integration (8 tests)

24. ✅ **ws.ts tests** — rawDataToString for all input types (8 tests)
25. ✅ **TLS fingerprint tests** — normalization edge cases (8 tests)
26. ✅ **TUI ANSI helpers tests** — strip, dw, pad, trunc, fit, colors (22 tests)
27. ✅ **Expanded trust policy tests** — edge cases for all trust tiers and verification (9 tests)
28. ✅ **Expanded command envelope tests** — validation and resolution edge cases (7 tests)
29. ✅ **Architecture edge case tests** — boundary conditions across all new modules (21 tests)

### Results: 135 → 505 tests (+274%), 38 → 51 source modules (+34%), 17 → 44 test files (+159%)
