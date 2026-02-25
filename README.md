<p align="center">
  <img src="assets/clawmesh-logo.svg" alt="ClawMesh" width="640" />
</p>

<p align="center">
  <strong>Mesh-first AI gateway — stripped-down <a href="https://github.com/openclaw/openclaw">OpenClaw</a> fork for P2P mesh networking</strong>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="#cli">CLI</a> &middot;
  <a href="#test-suite">Tests</a> &middot;
  <a href="#configuration">Config</a>
</p>

---

## What is ClawMesh?

ClawMesh makes a group of devices behave like **one distributed, capability-aware gateway**.

It strips OpenClaw's 43+ channel plugins, browser, TUI, media processing, and other heavy subsystems down to the mesh networking core:

| Kept | Stripped |
|------|---------|
| Mesh protocol (mDNS discovery, peer trust, forwarding) | All 43 channel plugins (Telegram, Discord, Slack, WhatsApp, ...) |
| Ed25519 device identity + mutual auth | Browser, canvas, TUI, cron, wizard |
| Capability-based routing (local-first, mesh fallback) | Media processing, TTS, link understanding |
| Peer registry + WebSocket connections | Auto-reply, hooks, plugin system |
| CLI for identity, trust, and status | Web UI, mobile apps, pairing |

## Why?

Most AI gateway stacks assume a single machine. That breaks when your capabilities are spread across devices:

- **Laptop** has your API keys and control surface
- **Desktop** has GPUs and local models
- **Jetson/Pi** has hardware sensors and edge inference
- **Server** has private network access

ClawMesh lets these discover each other via **mDNS**, establish **Ed25519 mutual trust**, and **route messages** to whichever peer has the right capability — all without a central coordinator.

## Quickstart

```bash
# Requirements: Node.js 22+, pnpm
pnpm install
pnpm test          # 62 tests across 6 files
pnpm typecheck     # tsc --noEmit
```

## Architecture

```
src/mesh/
  manager.ts          # Orchestrator: discovery, peer clients, registries
  discovery.ts        # mDNS polling with peer-discovered/peer-lost events
  capabilities.ts     # Capability registry (channel:*, skill:*)
  routing.ts          # Local-first routing: local caps -> mesh peers -> unavailable
  forwarding.ts       # RPC-based message forwarding between peers
  peer-trust.ts       # File-backed trust store with atomic writes
  peer-registry.ts    # Connected peer session tracking
  handshake.ts        # Ed25519 signed auth payloads
  server-methods/     # Gateway RPC handlers (peers, trust, forward)

src/infra/
  device-identity.ts  # Ed25519 key generation + deviceId derivation
  bonjour-discovery.ts # mDNS/Avahi/dns-sd beacon scanning

src/cli/
  clawmesh-cli.ts     # Commander-based CLI

src/terminal/theme.ts # Lobster palette theming (chalk)
```

### Routing Decision Flow

```
resolveMeshRoute("telegram", capabilityRegistry, localCapabilities)
  |
  |-- localCapabilities.has("channel:telegram")? --> { kind: "local" }
  |
  |-- capabilityRegistry.findPeerWithChannel("telegram")? --> { kind: "mesh", peerDeviceId }
  |
  \-- otherwise --> { kind: "unavailable" }
```

## CLI

```bash
clawmesh identity                     # Print device ID + public key
clawmesh trust list                   # List trusted peers
clawmesh trust add <deviceId>         # Trust a peer
clawmesh trust add <deviceId> --name "Jetson"
clawmesh trust remove <deviceId>      # Untrust a peer
clawmesh peers                        # List connected mesh peers
clawmesh status                       # Gateway + mesh status
```

## Test Suite

**62 tests, 6 files** — all built test-first with Red/Green TDD.

| File | Tests | What it covers |
|------|-------|----------------|
| `src/strip.test.ts` | 31 | Stripped directories don't exist |
| `src/strip-imports.test.ts` | 2 | No source file imports from 32 stripped modules |
| `src/mesh/smoke.test.ts` | 8 | All mesh modules import cleanly |
| `src/mesh/routing.test.ts` | 7 | Capability-based local-first routing |
| `src/cli/cli.test.ts` | 4 | CLI command structure |
| `src/mesh/integration.test.ts` | 10 | Routing + forwarding end-to-end |

```bash
pnpm test                              # Run all tests
pnpm vitest run src/mesh/              # Mesh tests only
```

## Configuration

Mesh config in your gateway YAML/JSON:

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

## Design Principles

- **Mesh-first**: Peer connectivity and forwarding are first-class primitives
- **Capability-driven**: Route by advertised capabilities, not hard-coded plugin lookups
- **Trust before traffic**: Discovered peers are ignored unless explicitly trusted
- **Local-first**: Always prefer local capabilities over mesh peers
- **Lean core**: Small enough to reason about and deploy on edge devices

## Roadmap

- [ ] Wire runnable `clawmesh start` gateway boot path
- [ ] Build output + npm packaging for the `clawmesh` binary
- [ ] Multi-node end-to-end examples (discovery + trust + forwarding)
- [ ] Deployment docs for home lab / LAN setups
- [ ] Capability announcement protocol refinement

## License

MIT
