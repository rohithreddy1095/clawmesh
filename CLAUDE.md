# CLAUDE.md — ClawMesh

## Project Overview

ClawMesh is a **mesh-first AI gateway** — a stripped-down fork of [OpenClaw](https://github.com/openclaw/openclaw) focused exclusively on P2P mesh networking. It makes a group of devices behave like one distributed, capability-aware gateway by providing mDNS discovery, Ed25519 mutual authentication, capability-based routing, and RPC message forwarding between peers.

All 43+ channel plugins, browser, TUI, media processing, and other heavy subsystems from OpenClaw have been removed. The codebase enforces this via dedicated strip tests.

## Quick Reference

```bash
pnpm install            # Install dependencies (Node.js 22+, pnpm required)
pnpm test               # Run all tests (62 tests across 6 test files)
pnpm typecheck          # Type-check with tsc --noEmit
pnpm lint               # Lint with oxlint
pnpm build              # Compile TypeScript (tsc)
pnpm test:watch         # Run tests in watch mode
```

## Tech Stack

- **Runtime**: Node.js 22+, ESM modules (`"type": "module"`)
- **Language**: TypeScript 5.9+ (strict mode, ES2023 target, NodeNext module resolution)
- **Package manager**: pnpm
- **Test framework**: Vitest 4 (pool: forks, maxWorkers: 4, 120s timeout)
- **Linter**: oxlint (config: `oxlintrc.json`)
- **Key dependencies**: ws (WebSocket), commander (CLI), chalk (terminal colors), @homebridge/ciao (mDNS), zod + @sinclair/typebox + ajv (validation), express 5, tslog (logging), undici (HTTP)

## Directory Structure

```
src/
├── mesh/                  # Core mesh networking (the heart of ClawMesh)
│   ├── manager.ts         # Orchestrator: discovery, peer clients, registries
│   ├── discovery.ts       # mDNS polling with peer-discovered/peer-lost events
│   ├── capabilities.ts    # Capability registry (channel:*, skill:*)
│   ├── routing.ts         # Local-first routing: local → mesh peers → unavailable
│   ├── forwarding.ts      # RPC-based message forwarding between peers
│   ├── peer-trust.ts      # File-backed trust store with atomic writes + locking
│   ├── peer-registry.ts   # Connected peer session tracking
│   ├── peer-client.ts     # Outbound WebSocket client for mesh peers
│   ├── peer-server.ts     # Inbound WebSocket server handlers
│   ├── handshake.ts       # Ed25519 signed auth payloads
│   ├── types.ts           # Shared mesh types (PeerSession, MeshForwardPayload, etc.)
│   └── server-methods/    # Gateway RPC handlers
│       ├── forward.ts     # mesh.message.forward handler
│       ├── peers.ts       # Peer listing handler
│       └── trust.ts       # Trust management handler
├── infra/                 # Infrastructure utilities
│   ├── device-identity.ts # Ed25519 key generation + deviceId derivation
│   ├── bonjour-discovery.ts  # mDNS/Avahi/dns-sd beacon scanning
│   ├── bonjour-ciao.ts    # @homebridge/ciao mDNS integration
│   ├── file-lock.ts       # File locking primitives
│   └── ...                # Networking, security, heartbeat, env, etc.
├── cli/                   # Commander-based CLI
│   ├── clawmesh-cli.ts    # CLI entry point (identity, trust, peers, status)
│   └── gateway-cli/       # Gateway-level CLI commands
├── config/                # Configuration loading, schema, validation (zod)
│   ├── config.ts          # Main config loader
│   ├── types.mesh.ts      # MeshConfig type definition
│   ├── schema.ts          # Config schema definition
│   └── paths.ts           # State/config directory resolution
├── gateway/               # Gateway server (HTTP + WebSocket)
│   ├── server.ts          # Express + WS gateway server
│   ├── auth.ts            # Gateway authentication
│   └── server-methods/    # RPC method handlers
├── terminal/              # Terminal UI helpers
│   ├── theme.ts           # Lobster palette theming (chalk)
│   └── palette.ts         # Color constants
├── plugin-sdk/            # Shared utilities inherited from OpenClaw
│   ├── json-store.ts      # Atomic JSON file read/write
│   └── ...                # Account ID, webhooks, text chunking
├── agents/                # Agent subsystem (inherited from OpenClaw)
├── providers/             # LLM provider integrations
├── routing/               # Message routing (account-level)
├── security/              # Security scanning, secrets, external content
├── sessions/              # Session management
├── shared/                # Shared types and utilities
├── logging/               # Logging infrastructure
├── channels/              # Channel interface types
├── types/                 # Third-party type declarations (.d.ts)
├── utils/                 # General utilities
├── globals.ts             # Global state
├── runtime.ts             # Runtime bootstrapping
└── utils.ts               # Top-level utility functions
```

## Entry Points

- **CLI binary**: `clawmesh.mjs` → imports `src/cli/clawmesh-cli.ts`
- **Package main**: `dist/index.js` (after `pnpm build`)
- **CLI commands**: `identity`, `trust list|add|remove`, `peers`, `status`

## Architecture Concepts

### Mesh Protocol Flow
1. **Discovery**: Peers find each other via mDNS (`MeshDiscovery`) or static config
2. **Trust**: Discovered peers are checked against a file-backed trust store (`peer-trust.ts`)
3. **Handshake**: Ed25519 mutual authentication via signed payloads (`handshake.ts`)
4. **Registration**: Connected peers register capabilities in `MeshCapabilityRegistry`
5. **Routing**: Messages are routed local-first, then to mesh peers by capability (`routing.ts`)
6. **Forwarding**: Messages forwarded via `mesh.message.forward` RPC over WebSocket

### Routing Decision
```
resolveMeshRoute(channel, capabilityRegistry, localCapabilities)
  → localCapabilities.has("channel:<name>")? → { kind: "local" }
  → capabilityRegistry.findPeerWithChannel("<name>")? → { kind: "mesh", peerDeviceId }
  → otherwise → { kind: "unavailable" }
```

### Capability Format
Capabilities use a `type:name` format:
- `channel:telegram`, `channel:slack`, `channel:whatsapp`
- `skill:summarize`, `skill:weather`

### Device Identity
- Ed25519 keypair generated on first run
- `deviceId` = SHA256 hex of the raw public key bytes
- Stored at `<stateDir>/identity/device.json` (mode 0o600)
- Trust store at `<stateDir>/mesh/trusted-peers.json`

## Testing

### Test Organization
Tests live alongside source files with `.test.ts` suffix. The test suite follows **Red/Green TDD**.

| File | What it covers |
|------|----------------|
| `src/strip.test.ts` | Stripped directories don't exist (31 checks) |
| `src/strip-imports.test.ts` | No source file imports from stripped modules |
| `src/mesh/smoke.test.ts` | All mesh modules import cleanly |
| `src/mesh/routing.test.ts` | Capability-based local-first routing |
| `src/cli/cli.test.ts` | CLI command structure |
| `src/mesh/integration.test.ts` | Routing + forwarding end-to-end |

### Vitest Configuration
- **Pool**: forks (not threads)
- **Max workers**: 4
- **Timeouts**: 120 seconds (both test and hook)
- **Includes**: `src/**/*.test.ts`, `test/**/*.test.ts`
- **Excludes**: `*.live.test.ts`, `*.e2e.test.ts`
- Global stubs are auto-unstubbed between tests

### Running Tests
```bash
pnpm test                          # All tests
pnpm vitest run src/mesh/          # Mesh tests only
pnpm vitest run src/mesh/routing   # Single test file
pnpm test:watch                    # Watch mode
```

## Code Conventions

### TypeScript
- **Strict mode** enabled (all strict checks)
- **ESM-only**: Use `.js` extensions in imports (TypeScript compiles `.ts` → `.js`)
- **Path aliases**: `openclaw/plugin-sdk` → `./src/plugin-sdk/index.ts`
- Imports use `import type` for type-only imports
- No `noEmit: true` is set in tsconfig — use `pnpm typecheck` for checking

### Naming
- Files use **kebab-case**: `peer-trust.ts`, `device-identity.ts`
- Tests use **kebab-case** with `.test.ts` suffix next to their source
- Classes use **PascalCase**: `MeshCapabilityRegistry`, `MeshManager`
- Functions use **camelCase**: `resolveMeshRoute`, `forwardMessageToPeer`
- Types/interfaces use **PascalCase**: `PeerSession`, `MeshForwardPayload`
- Constants use **UPPER_SNAKE_CASE**: `STORE_LOCK_OPTIONS`, `EMPTY_STORE`

### Patterns
- **Local-first routing**: Always prefer local capabilities over mesh peers
- **Trust before traffic**: Never communicate with untrusted peers
- **Atomic writes**: JSON stores use atomic write + file locking
- **Event-driven**: Discovery uses EventEmitter pattern (`peer-discovered`, `peer-lost`)
- **Deterministic connection direction**: Lower deviceId initiates (avoids duplicate connections)

## Stripped Modules (Do Not Re-introduce)

The following modules were removed from the OpenClaw fork and must **never** be re-added. Tests in `strip.test.ts` and `strip-imports.test.ts` enforce this:

`browser`, `canvas-host`, `cron`, `daemon`, `discord`, `imessage`, `line`, `link-understanding`, `media`, `media-understanding`, `memory`, `node-host`, `pairing`, `signal`, `slack`, `telegram`, `tts`, `tui`, `web`, `whatsapp`, `wizard`, `auto-reply`, `hooks`, `process`, `scripts`, `docs`, `compat`, `commands`, `plugins`, `test-helpers`, `test-utils`

No source file should import from any of these paths.

## Configuration

Mesh configuration schema (in gateway YAML/JSON):

```yaml
mesh:
  enabled: true
  scanIntervalMs: 30000
  capabilities:
    - channel:telegram
    - skill:summarize
  peers:
    - url: wss://jetson.local:18789
      deviceId: sha256-of-peer-public-key
      tlsFingerprint: "sha256:..."
```

Defined in `src/config/types.mesh.ts` with Zod schema in `src/config/zod-schema.mesh.ts`.

## Common Workflows

### Adding a new mesh RPC method
1. Define the handler in `src/mesh/server-methods/<method>.ts`
2. Add tests in `src/mesh/server-methods/<method>.test.ts`
3. Wire it into `src/mesh/peer-server.ts`
4. Update `src/mesh/manager.ts` if the method needs orchestration

### Adding a new capability type
1. Update `MeshCapabilityRegistry` in `src/mesh/capabilities.ts` with a finder method
2. Update routing logic in `src/mesh/routing.ts`
3. Add tests covering the new capability routing

### Adding a new CLI command
1. Add the command in `src/cli/clawmesh-cli.ts` using Commander
2. Add tests in `src/cli/cli.test.ts`

## Important Constraints

- **Do not import from stripped modules** — the strip-imports test will fail
- **Do not re-create stripped directories** — the strip test will fail
- **Always run `pnpm test`** after changes to verify no regressions
- **Always run `pnpm typecheck`** to ensure type safety
- **Use `.js` extensions** in all TypeScript import paths (ESM requirement)
- **Mesh tests should not require network access** — mock mDNS and WebSocket in tests
