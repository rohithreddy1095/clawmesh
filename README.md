<p align="center">
  <img src="assets/clawmesh-logo.svg" alt="ClawMesh" width="640" />
</p>

<p align="center">
  <strong>Mesh-first distributed AI gateway for multi-device sensing, planning, and safe execution.</strong>
</p>

<p align="center">
  <a href="#what-is-clawmesh">Overview</a> &middot;
  <a href="#quickstart">Quickstart</a> &middot;
  <a href="#deployment-patterns">Deployment</a> &middot;
  <a href="#trust-and-safety">Safety</a> &middot;
  <a href="#operator-surfaces">Operator Surfaces</a> &middot;
  <a href="#development">Development</a>
</p>

---

## What is ClawMesh?

ClawMesh turns a set of independent devices into one **capability-aware, trust-gated mesh runtime**.

A laptop can host the planner and operator UI, a Jetson can expose sensors and actuators, another node can host models or private-network access, and the mesh routes work to the right place.

ClawMesh is built around a few practical ideas:

- **Each device keeps its own identity** via Ed25519 keys and a stable device ID.
- **Peers discover or connect to each other directly** over mDNS or static/WAN peer definitions.
- **Context propagates across the mesh** so the planner reasons over shared state, not just one process.
- **Capabilities determine routing** instead of hard-coded host assumptions.
- **Actuation is trust-gated** so LLM-only reasoning cannot directly trigger physical execution.

## Why teams use it

ClawMesh is useful when your real system is distributed across machines:

- a **command center** with credentials, operator chat, and approvals
- a **field node** with sensors and actuators
- an **edge node** with local inference or camera pipelines
- a **private network node** that can reach systems others cannot

Instead of building point-to-point glue for each pair, ClawMesh gives you a mesh with:

- peer trust
- capability routing
- mesh-wide context
- operator approval flows
- health and status surfaces
- explicit WAN/static deployment modes

## Project status

ClawMesh is being hardened toward production-style field deployments, but the repo is still evolving quickly.

Important realities:

- the runtime and safety model are real and actively tested
- WAN/static deployment support now includes transport labeling, posture reporting, and basic WAN enforcement
- the package is **not yet published to npm**
- the current checkout expects local `file:` dependencies from a sibling `../pi-mono`

That means this repo is best treated today as a **serious working codebase under active development**, not a finished packaged product.

## Core capabilities

### Mesh runtime
- mDNS discovery for trusted LAN peers
- static peer configuration for WAN or discovery-disabled deployments
- stable mesh identity and protocol generation checks
- explicit node roles (`node`, `planner`, `field`, `sensor`, `actuator`, `viewer`, `standby-planner`)
- peer lifecycle handling (`peer.leaving`, `peer.down`, reachability confirmation)

### Intelligence and control
- Pi-powered planner integration
- proposal-based execution flow with approval levels
- mesh-wide world model built from propagated context frames
- planner ownership and HA groundwork

### Safety and trust
- Ed25519 mutual identity
- local trust store
- actuation trust tiers (T0-T3)
- approval levels (L0-L3)
- hard block on LLM-only physical actuation

### Operator experience
- CLI runtime and one-shot commands
- Telegram bot integration
- terminal TUI
- browser UI in `ui/`
- machine-readable status via `mesh.status`, `mesh.health`, and `mesh.peers`

### WAN/static deployment hardening
- discovery-disabled static mode
- transport labels (`relay`, `vpn`, `lan`, `local`, etc.)
- URL normalization from `http(s)` to `ws(s)`
- startup diagnostics for insecure/unpinned WAN peers
- posture surfaced in health, status, operator views, startup output, and logs
- enforcement for WAN-labeled peers while keeping explicit local labels permissive

---

## Quickstart

### Requirements

- Node.js **22+**
- `pnpm`
- a sibling checkout of `../pi-mono` for local `file:` dependencies

Optional but commonly needed:

- provider API keys for planner usage
- Telegram bot token if using Telegram

### Install

```bash
pnpm install
pnpm typecheck
pnpm test
```

### Running from a source checkout

If `clawmesh` is not installed on your PATH yet, use:

```bash
pnpm exec tsx clawmesh.ts <command>
```

The examples below use `clawmesh` for readability. In a source checkout, replace that with `pnpm exec tsx clawmesh.ts`.

### Minimal single-node runtime

```bash
clawmesh start --name dev-node --capability channel:clawmesh
```

### Command center with planner + TUI

```bash
clawmesh start \
  --name ops-main \
  --role planner \
  --command-center \
  --tui \
  --pi-model anthropic/claude-sonnet-4-5-20250929
```

### Field node with mock sensor + mock actuator

```bash
clawmesh start \
  --name field-jetson \
  --role field \
  --field-node \
  --mock-sensor \
  --mock-actuator
```

### Query a running node

```bash
clawmesh status --url ws://localhost:18789
clawmesh status --url ws://localhost:18789 --events
clawmesh peers
clawmesh world
```

---

## Deployment patterns

### 1. LAN / zero-config discovery

Use discovery when nodes share a local network and you want trusted peers to auto-connect.

```bash
clawmesh start --name edge-a --capability sensor:mock
clawmesh start --name edge-b --capability channel:clawmesh
```

Notes:
- mDNS is enabled by default
- discovery only helps once peers are trusted
- auto-connected discovery peers are labeled `mdns`

### 2. Static / WAN / discovery-disabled mode

Use this when peers are not on the same LAN, or when you want deterministic startup with explicit peers.

```bash
clawmesh start \
  --name wan-node \
  --no-discovery \
  --peer "<deviceId>=https://relay.example.com/mesh|sha256:ABCDEF...|relay"
```

ClawMesh normalizes:
- `http://...` → `ws://...`
- `https://...` → `wss://...`

### 3. Stable named mesh

Use a shared mesh name when you want nodes to reject accidental cross-mesh connections.

```bash
clawmesh start --name ops-main --mesh-name bhoomi-prod --role planner
clawmesh start --name field-jetson --mesh-name bhoomi-prod --role field
```

### 4. Roles

Common role patterns:

- `planner` — primary planning node
- `standby-planner` — hot standby for planner HA groundwork
- `field` — mixed edge node with sensors/actuators
- `sensor` — read-focused node
- `actuator` — execution-focused node
- `viewer` — passive observer that does not contribute routing capabilities

---

## Static peer format

Static peers are passed with `--peer`.

### Supported format

```text
<deviceId>=<url>|<tlsFingerprint>|<transportLabel>
```

Where:
- `deviceId` is the trusted peer device ID
- `url` may be `ws://`, `wss://`, `http://`, or `https://`
- `tlsFingerprint` is optional for local peers, but required for WAN-safe labeled peers
- `transportLabel` is optional but strongly recommended for non-LAN peers

### Examples

#### Local static peer

```bash
clawmesh start --peer "<deviceId>=ws://10.0.0.5:18789||lan"
```

If you want to specify a transport label without a fingerprint, leave the middle field empty:

```text
<deviceId>=ws://10.0.0.5:18789||lan
```

#### Relay/WAN static peer

```bash
clawmesh start --no-discovery \
  --peer "<deviceId>=https://relay.example.com/mesh|sha256:ABCDEF...|relay"
```

#### VPN/WAN static peer

```bash
clawmesh start --no-discovery \
  --peer "<deviceId>=wss://vpn.example.com/mesh|sha256:ABCDEF...|vpn"
```

---

## Transport labels and WAN policy

ClawMesh now uses transport labels as an operator-facing and safety-relevant signal.

| Label | Intent | Behavior |
|---|---|---|
| `mdns` | auto-discovered local peer | local / permissive |
| `lan` | explicit local network peer | local / permissive |
| `local` | explicit local alias | local / permissive |
| `relay` | WAN relay/static path | requires secure pinned transport |
| `vpn` | WAN tunnel/static path | requires secure pinned transport |
| any other non-local label | treated as WAN by default | requires secure pinned transport |

### Current WAN enforcement

For WAN-labeled peers:

- `ws://` is refused
- unpinned `wss://` is refused
- pinned `wss://` is allowed

This keeps local labels permissive while making WAN/static mistakes obvious and safer.

---

## Trust and safety

ClawMesh is opinionated here.

### Peer trust

Discovered peers are not automatically trusted just because they are visible.

You explicitly trust peers with:

```bash
clawmesh trust add <deviceId>
clawmesh trust list
clawmesh trust remove <deviceId>
```

Trusted peers are persisted in:

```text
~/.clawmesh/mesh/trusted-peers.json
```

### Evidence trust tiers

| Tier | Meaning |
|---|---|
| `T0` | planning inference |
| `T1` | unverified observation |
| `T2` | operational observation |
| `T3` | verified action evidence |

### Approval levels

| Level | Meaning |
|---|---|
| `L0` | safe read-only |
| `L1` | bounded auto-execute |
| `L2` | human approval required |
| `L3` | strongest verification / on-site style control |

### Critical safety rule

**LLM-only evidence is hard-blocked from physical actuation.**

That means planning can propose, summarize, route, and explain — but it cannot unilaterally trigger real-world actuation without the required trust and approval evidence.

---

## Operator surfaces

### CLI

Main commands:

```bash
clawmesh identity
clawmesh start
clawmesh status --url ws://localhost:18789 --events
clawmesh trust list
clawmesh credential list
clawmesh gateway-connect --url ws://192.168.1.39:18789
clawmesh gateways
```

### Telegram

```bash
clawmesh start --command-center --telegram --telegram-chat <chatId>
```

Telegram supports:
- `/status`
- `/world`
- `/proposals`
- `/approve <id>`
- `/reject <id>`
- `/alerts`

### TUI

```bash
clawmesh start --command-center --tui
```

The TUI gives you:
- peers
- world/context activity
- proposals
- planner state
- interactive command input

### Web UI

```bash
cd ui
pnpm install
pnpm dev
```

The browser UI provides digital-twin, command, and telemetry views.

---

## Observability

ClawMesh exposes runtime state through:

- `mesh.peers`
- `mesh.status`
- `mesh.health`
- startup diagnostics
- connection and error logs

Current operator-visible surfaces include:
- discovery mode
- connected peers
- configured static peers
- transport labels
- static peer security posture (`insecure`, `tls-unpinned`, `tls-pinned`)
- planner activity / leader context

This matters especially in WAN/static deployments, where the question is often:

> “What did this node think it was supposed to connect to, and how safe was that transport?”

---

## Architecture at a glance

### Runtime core

- `src/mesh/node-runtime.ts` — node orchestrator
- `src/mesh/peer-connection-manager.ts` — outbound peer lifecycle
- `src/mesh/peer-client.ts` / `peer-server.ts` — WebSocket transport
- `src/mesh/discovery.ts` — mDNS discovery
- `src/mesh/server-methods/` — RPC handlers

### Intelligence layer

- `src/agents/pi-session.ts` — planner/session integration
- `src/agents/extensions/` — mesh tools and operator commands
- `src/agents/proposal-*.ts` — proposal lifecycle and formatting

### Channels and UI

- `src/channels/telegram.ts` — Telegram bridge
- `src/tui/` — terminal dashboard
- `ui/` — web dashboard

### State and identity

- `src/infra/device-identity.ts` — Ed25519 identity
- `src/mesh/peer-trust.ts` — trusted peer store
- `src/infra/credential-store.ts` — credential persistence

---

## State and file locations

By default ClawMesh stores local state under:

```text
~/.clawmesh
```

Override with:

```bash
export CLAWMESH_STATE_DIR=/path/to/custom/state
```

Important files:

| Path | Purpose |
|---|---|
| `~/.clawmesh/identity/device.json` | local Ed25519 identity |
| `~/.clawmesh/credentials.json` | provider/channel credentials |
| `~/.clawmesh/mesh/trusted-peers.json` | trusted peer store |
| `~/.clawmesh/mesh/gateways.json` | saved gateway targets |
| `~/.clawmesh/mesh/patterns.json` | learned operator patterns |
| `~/.clawmesh/world-model-snapshot.json` | world-model snapshot for restart recovery |

---

## Credential management

```bash
clawmesh credential set provider/google <api-key>
clawmesh credential set provider/anthropic <api-key>
clawmesh credential set channel/telegram <bot-token>
clawmesh credential list
clawmesh credential get provider/google
```

Stored provider credentials are injected into `process.env` on startup so the planner can use them without manually exporting each variable.

---

## Development

### Common commands

```bash
pnpm install
pnpm typecheck
pnpm test
```

### Targeted test runs

```bash
pnpm vitest run src/mesh/
pnpm vitest run src/agents/
pnpm vitest run src/channels/
pnpm vitest run src/cli/
```

### Notes for contributors

- prefer small, test-backed slices
- mesh reliability changes are developed Red/Green
- existing trust/safety constraints should not be weakened casually
- WAN/static behavior should stay explicit and operator-visible

---

## Setup guides and docs

- [Getting Started Guide](docs/getting-started.md)
- [Command Center Setup](docs/setup-command-center.md)
- [Field Node Setup](docs/setup-field-node.md)
- [Bhoomi Farm Twin Spec](docs/bhoomi-farm-twin-spec-v0.md)
- [Mesh Safety Skill / Policy Context](.pi/skills/mesh-safety.md)

---

## Current focus areas

- field deployment hardening
- WAN/static connectivity safety and observability
- planner HA groundwork
- real sensor/actuator integrations
- packaging and distribution cleanup

---

## License

MIT
