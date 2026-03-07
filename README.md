<p align="center">
  <img src="assets/clawmesh-logo.svg" alt="ClawMesh" width="640" />
</p>

<p align="center">
  <strong>Distributed AI mesh — independent claws that join into one intelligent network</strong>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="#interacting-with-the-mesh">Interaction</a> &middot;
  <a href="#cli">CLI</a> &middot;
  <a href="#emergent-context-propagation">Context</a> &middot;
  <a href="#test-suite">Tests</a> &middot;
  <a href="#configuration">Config</a>
</p>

---

## What is ClawMesh?

ClawMesh makes a group of devices behave like **one distributed, capability-aware gateway**.

Each device is a **claw** — an independent mesh node with its own identity, capabilities, and intelligence. Claws discover each other, establish trust, and form a mesh where context flows organically and execution routes to whichever node has the right capability.

| What it does |
|---|
| Mesh protocol — mDNS discovery, Ed25519 peer trust, capability-based routing |
| Emergent context — sensor observations gossip across the mesh, building distributed awareness |
| Pi-powered intelligence — LLM planner reasons over mesh-wide context, proposes actions |
| Pattern learning — operator approve/reject decisions propagate as learned patterns |
| Layered trust — T0–T3 evidence tiers, L0–L3 approval levels, LLM hard-blocked from actuation |
| Multi-channel — Telegram bot, TUI dashboard, Web UI, CLI |

## Why?

Most AI stacks assume a single machine. That breaks when your capabilities are spread across devices:

- **Laptop** has your API keys and control surface
- **Jetson/Pi** has hardware sensors and edge inference
- **Desktop** has GPUs and local models
- **Server** has private network access

ClawMesh lets these discover each other via **mDNS**, establish **Ed25519 mutual trust**, and **route messages** to whichever peer has the right capability — all without a central coordinator.

## Usage & Setup Guides

- [Getting Started Guide](docs/getting-started.md)
- [Command Center Setup (Mac/PC)](docs/setup-command-center.md)
- [Field Node Setup (Jetson/Pi)](docs/setup-field-node.md)
- [Bhoomi Farm Twin Spec](docs/bhoomi-farm-twin-spec-v0.md)
- [Trust & Safety Policy](.pi/skills/mesh-safety.md)

## Quickstart

```bash
# Requirements: Node.js 22+, pnpm
pnpm install
pnpm test          # 135 tests across 17 files
pnpm typecheck     # tsc --noEmit
```

## Architecture

```
src/agents/
  extensions/
    clawmesh-mesh-extension.ts  # Mesh tools for Pi (query_world_model, propose_task, execute, etc.)
  pi-session.ts                 # Pi-powered intelligence — AgentSession with conversational loop
  pattern-memory.ts             # Learns from operator approve/reject → gossips mature patterns
  farm-context-loader.ts        # Loads Bhoomi farm YAML → structured FarmContext
  types.ts                      # Shared types: TaskProposal, ThresholdRule, FarmContext

src/mesh/
  node-runtime.ts         # Orchestrator: WebSocket server, peers, planner, UI subscribers
  discovery.ts            # mDNS polling with peer-discovered/peer-lost events
  capabilities.ts         # Capability registry (channel:*, skill:*, actuator:*)
  routing.ts              # Local-first routing: local caps → mesh peers → unavailable
  forwarding.ts           # RPC-based message forwarding between peers
  peer-trust.ts           # File-backed trust store with atomic writes
  peer-registry.ts        # Connected peer session tracking
  peer-client.ts          # Outbound WebSocket connection to remote peers
  peer-server.ts          # Inbound WebSocket connection handler
  handshake.ts            # Ed25519 signed auth payloads
  context-types.ts        # ContextFrame types for emergent context
  context-propagator.ts   # Broadcast context frames to mesh peers (gossip)
  world-model.ts          # Ingest and track mesh-wide knowledge
  mock-sensor.ts          # Mock sensor for testing context propagation
  mock-actuator.ts        # Mock actuator for trust-gated command testing
  trust-policy.ts         # T0–T3 trust tier evaluation + LLM-only actuation blocking
  command-envelope.ts     # ClawMesh command wire format
  gateway-connect.ts      # Connect to remote gateways
  gateway-config.ts       # Saved gateway target management
  server-methods/         # Gateway RPC handlers (peers, trust, forward)

src/channels/
  telegram.ts             # Telegram bot — thin mesh-native bridge (long-polling, no webhook)
  telegram.test.ts        # Telegram channel tests

src/tui/
  mesh-tui.ts             # Interactive terminal dashboard (peers, gossip, proposals, input)
  ansi.ts                 # ANSI escape helpers for TUI rendering

src/infra/
  device-identity.ts      # Ed25519 key generation + deviceId derivation
  credential-store.ts     # Persistent credential store (~/.clawmesh/credentials.json)
  credential-store.test.ts
  ws.ts                   # WebSocket utility helpers

src/cli/
  clawmesh-cli.ts         # Commander-based CLI (start, identity, trust, credential, etc.)

ui/                       # Next.js web dashboard
  src/app/page.tsx        # Digital twin overview with mesh node visualization
  src/app/command/page.tsx  # Chat-first command center (send intents, see responses)
  src/app/twin/page.tsx   # Digital twin dashboard
  src/app/telemetry/page.tsx  # Telemetry view
  src/components/
    ChatMessage.tsx       # Chat bubble for operator/agent messages
    CitationBadge.tsx     # Inline citation for sensor data references
    ProposalCard.tsx      # Approve/reject card for task proposals
    MeshNode.tsx          # Mesh node visualization component
    Sidebar.tsx           # Navigation sidebar
  src/lib/
    store.ts              # Zustand store for mesh state
    useMesh.ts            # WebSocket hook connecting UI to mesh node
    utils.ts              # Shared utilities

.pi/                      # Pi agent skills and prompt templates
  skills/
    bhoomi-farm.md        # Farm domain knowledge for the planner
    mesh-operations.md    # Mesh operation procedures
    mesh-safety.md        # Safety rules and trust policy
  prompts/
    emergency.md          # Emergency response prompt template
    irrigate.md           # Irrigation decision prompt
    morning-check.md      # Daily farm check prompt
```

### Routing Decision Flow

```
resolveMeshRoute("telegram", capabilityRegistry, localCapabilities)
  │
  ├── localCapabilities.has("channel:telegram")? → { kind: "local" }
  │
  ├── capabilityRegistry.findPeerWithChannel("telegram")? → { kind: "mesh", peerDeviceId }
  │
  └── otherwise → { kind: "unavailable" }
```

## Interacting with the Mesh

ClawMesh provides five ways to interact with mesh nodes:

### 1. Telegram Bot (`--telegram`)

```bash
clawmesh start --name mac-main --command-center --telegram --telegram-chat 7419077732
```

A Telegram bot that bridges your chat to the mesh:
- **Natural language** — type messages, get Pi planner responses with sensor citations
- **Commands** — `/status`, `/world`, `/proposals`, `/approve <id>`, `/reject <id>`, `/alerts`
- **Proposal buttons** — inline approve/reject buttons on task proposals
- **Alert forwarding** — threshold breaches pushed to subscribed chats
- **Long-polling** — no webhook, no public IP needed (works from Jetson behind NAT)

Set up via `clawmesh credential set channel/telegram <bot-token>` or `TELEGRAM_BOT_TOKEN` env var.

### 2. Terminal readline (default)

When you run `clawmesh start`, an interactive stdin handler accepts commands:

| Command | Shortcut | What it does |
|---------|----------|-------------|
| `proposals` | `p` | List all task proposals with status |
| `approve <id>` | `a <id>` | Approve a proposal by task ID prefix |
| `reject <id>` | `r <id>` | Reject a proposal |
| `world` | `w` | Show recent world model frames |
| `status` / `mode` | `s` | Show planner mode (active/observing/suspended) |
| `resume` | — | Resume LLM calls from observing/suspended mode |
| `help` | `h` | Show available commands |
| *anything else* | — | Sent as natural language intent to the Pi planner |

### 3. TUI Dashboard (`--tui`)

```bash
clawmesh start --name mac-main --command-center --tui
```

A full-screen terminal dashboard with:
- **PEERS** column — connected mesh nodes with capabilities
- **GOSSIP** column — live context frame stream (observations, events, inferences)
- **PROPOSALS** section — pending/approved/rejected task proposals
- **WORLD** summary — current world model state
- **Status bar** — planner mode, peer count, frame count, uptime
- **Input line** — same commands as readline, plus free-text intents

### 4. Web UI Dashboard

```bash
cd ui && pnpm install && pnpm dev
```

A Next.js browser dashboard at `http://localhost:3000` with:
- **Digital Twin** (`/twin`) — mesh node visualization
- **Command Center** (`/command`) — chat-first interface: type intents, see LLM responses, approve/reject proposals inline
- **Telemetry** (`/telemetry`) — sensor data and frame history

Connects to the mesh node via WebSocket (`chat.subscribe` RPC) for live streaming of context frames, agent responses, and proposal events.

### 5. CLI one-shot commands

```bash
clawmesh identity                     # Print device ID + public key
clawmesh trust list                   # List trusted peers
clawmesh trust add <deviceId>         # Trust a peer
clawmesh trust remove <deviceId>      # Untrust a peer
clawmesh credential set <key> <val>   # Store a credential
clawmesh credential list              # List stored credentials
clawmesh demo-actuate --peer ...      # Send a test actuation command
clawmesh gateway-connect --url ...    # Connect to a remote gateway
clawmesh gateways                     # List saved gateway targets
```

## CLI

### Starting a Mesh Node

```bash
# Basic node
clawmesh start --name my-node --port 18789

# Field node (sensors + actuators)
clawmesh start --name jetson-field --field-node --sensor-interval 5000

# Command center (credentials auto-loaded from ~/.clawmesh/credentials.json)
clawmesh start --name mac-main --command-center \
  --peer "<deviceId>=ws://192.168.1.39:18789"

# Command center with Telegram
clawmesh start --name mac-main --command-center --telegram --telegram-chat <chatId> \
  --peer "<deviceId>=ws://192.168.1.39:18789"

# Command center with specific model
clawmesh start --name mac-main --command-center \
  --pi-model "anthropic/claude-sonnet-4-5-20250929" \
  --peer "<deviceId>=ws://192.168.1.39:18789"

# Command center with TUI dashboard
clawmesh start --name mac-main --command-center --tui \
  --peer "<deviceId>=ws://192.168.1.39:18789"

# Command center with thinking enabled
clawmesh start --name mac-main --command-center --thinking medium \
  --peer "<deviceId>=ws://192.168.1.39:18789"
```

### Credential Management

```bash
# Store API keys (persisted to ~/.clawmesh/credentials.json, mode 600)
clawmesh credential set provider/google <gemini-api-key>
clawmesh credential set provider/anthropic <anthropic-api-key>
clawmesh credential set channel/telegram <bot-token>

# Pipe from stdin (avoids shell history)
echo "sk-..." | clawmesh credential set provider/anthropic --from-stdin

# List stored credentials (values masked)
clawmesh credential list

# Provider keys are auto-injected as env vars on startup:
#   provider/google    → GEMINI_API_KEY
#   provider/anthropic → ANTHROPIC_API_KEY
#   provider/openai    → OPENAI_API_KEY
```

### CLI Flags Reference

| Flag | Description | Default |
|------|-------------|---------|
| `--name <name>` | Display name for this node | — |
| `--host <host>` | Host interface to bind | `0.0.0.0` |
| `--port <port>` | Port to listen on | `18789` |
| `--field-node` | Shorthand: enable sensors + actuators | — |
| `--command-center` | Shorthand: enable Pi planner | — |
| `--pi-planner` | Enable Pi-powered planner | — |
| `--pi-model <spec>` | Model spec (provider/model) | `google/gemini-3.1-pro-preview` |
| `--thinking <level>` | Thinking level (off/minimal/low/medium/high) | `off` |
| `--mock-sensor` | Enable mock soil moisture sensor | — |
| `--sensor-interval <ms>` | Sensor broadcast interval | `5000` |
| `--mock-actuator` | Enable mock actuator handler | — |
| `--telegram` | Enable Telegram bot channel | — |
| `--telegram-token <tok>` | Telegram bot token (or use credential store) | — |
| `--telegram-chat <id>` | Allowed Telegram chat ID (repeatable) | — |
| `--tui` | Launch interactive terminal dashboard | — |
| `--peer <id=url>` | Static peer to connect (repeatable) | — |
| `--capability <cap>` | Capability to advertise (repeatable) | — |
| `--planner-interval <ms>` | Proactive planner check interval | `60000` |

### Connecting to Remote Gateways

```bash
# Connect to a ClawMesh gateway and save as named target
clawmesh gateway-connect --url ws://192.168.1.39:18789 --password secret --save jetson

# Reconnect using saved name
clawmesh gateway-connect jetson

# List saved gateway targets
clawmesh gateways
```

## Emergent Context Propagation

ClawMesh nodes build intelligence organically through continuous context gossip.

When a sensor on one node detects a state change, that **observation becomes context** — a `ContextFrame` that propagates across the mesh. Other nodes ingest this context into their **world model**, building a live picture of mesh-wide state. Planner LLMs can reason over this emergent knowledge and forward execution commands to nodes with the right capabilities.

### Example: Field Sensor → Mesh Awareness → Intelligent Execution

```
1. Jetson sensor detects low soil moisture in zone-1
2. Context propagates to mesh:
     { kind: "observation", zone: "zone-1", moisture: 15.2%, status: "critical" }
3. Mac planner LLM reasons over mesh-wide context
4. Planner creates a TaskProposal (L2 — needs human approval)
5. Operator approves via Telegram / TUI / Web UI / CLI
6. Mac forwards execution command: actuate:pump:P1
7. Jetson validates trust policy and starts pump
```

No file syncing. No manual coordination. Just emergent intelligence.

### Context Frame Types

| Kind | Description | Example |
|------|-------------|---------|
| `observation` | Sensor readings, measurements | Soil moisture 15.2% |
| `event` | Task completed, state change | Pump P1 started |
| `human_input` | Operator commands, notes | "Inspect pump P1" |
| `inference` | LLM-derived conclusions | "Zone 1 needs irrigation" |
| `agent_response` | Conversational response from intelligence layer | Planner reasoning + citations |
| `capability_update` | Node capabilities changed | Node gained `actuator:pump` |

### Pattern Learning

When operators approve or reject proposals, the **PatternMemory** module learns from these decisions:

1. A threshold breach triggers a planner proposal
2. The operator approves or rejects it
3. PatternMemory records the trigger condition + action + outcome
4. After repeated consistent decisions, the pattern becomes **mature**
5. Mature patterns are **gossipped across the mesh** so other nodes learn too

Patterns are persisted to `~/.clawmesh/mesh/patterns.json` and survive restarts.

### Testing with Mock Sensor

```bash
# Terminal 1: Node broadcasting sensor context
clawmesh start --name sensor-node --port 18790 --mock-sensor --sensor-interval 3000

# Terminal 2: Observer node ingesting context
clawmesh start --name observer --port 18791 --peer "<sensor-deviceId>=ws://127.0.0.1:18790"
```

The observer's world model will log each ingested context frame:
```
[world-model] Ingested observation from sensor-node
```

## Trust & Safety

ClawMesh enforces a layered trust model:

| Tier | Name | Use |
|------|------|-----|
| T0 | Planning inference | LLM reasoning (read-only, never actuates) |
| T1 | Unverified observation | Raw sensor data before calibration |
| T2 | Operational observation | Calibrated sensor readings |
| T3 | Verified action evidence | Human-confirmed + sensor-backed actuation |

**Critical safety rule:** LLM-only evidence (`evidence_sources: ["llm"]`) is **hard-blocked** from triggering any physical actuation. The trust policy requires sensor or human evidence for any L2/L3 operation.

### Approval Levels

| Level | Description | Execution |
|-------|-------------|-----------|
| L0 | Safe read-only | Auto-execute |
| L1 | Bounded auto | Execute within defined limits |
| L2 | Human confirm | Awaits operator approval |
| L3 | On-site verify | Requires physical presence + approval |

## Test Suite

**135 tests across 17 files** — built test-first to ensure networking robustness and correct intelligence wiring.

| File | Tests | What it covers |
|------|-------|----------------|
| `src/mesh/peer-registry.test.ts` | 18 | Connection tracking, event broadcasting, RPC invoke |
| `src/mesh/capabilities.test.ts` | 14 | Dynamic capability advertising and lookups |
| `src/mesh/smoke.test.ts` | 14 | All mesh modules import cleanly |
| `src/infra/credential-store.test.ts` | 11 | Credential CRUD, env injection, masking, permissions |
| `src/mesh/integration.test.ts` | 10 | End-to-end routing + forwarding between nodes |
| `src/mesh/peer-trust.test.ts` | 10 | Ed25519 identity verification and local trust storage |
| `src/agents/planner.test.ts` | 8 | Farm context loading and task proposal types |
| `src/mesh/handshake.test.ts` | 7 | Ed25519 signed auth payloads |
| `src/mesh/forwarding.test.ts` | 7 | RPC payload construction and dispatch |
| `src/mesh/server-methods/forward.test.ts` | 7 | Forward handler trust evaluation |
| `src/mesh/routing.test.ts` | 7 | Capability-based local-first routing |
| `src/mesh/trust-policy.test.ts` | 6 | L0–L3 approval tiers and evidence validation |
| `src/channels/telegram.test.ts` | 5 | Telegram channel adapter structure and types |
| `src/mesh/node-runtime.test.ts` | 4 | Runtime lifecycle, start/stop, peer management |
| `src/mesh/command-envelope.test.ts` | 3 | Command wire format validation |
| `src/mesh/server-methods/peers.test.ts` | 3 | Peer listing RPC handler |
| `src/mesh/discovery.test.ts` | 1 | mDNS discovery module structure |

```bash
pnpm test                              # Run all tests
pnpm vitest run src/mesh/              # Mesh tests only
pnpm vitest run src/agents/            # Agent/planner tests only
pnpm vitest run src/channels/          # Channel adapter tests
```

## Configuration

Mesh config in your gateway YAML/JSON:

```yaml
mesh:
  enabled: true
  scanIntervalMs: 30000
  capabilities:
    - channel:clawmesh
    - actuator:mock
  peers:
    - url: wss://jetson.local:18789
      deviceId: sha256-of-peer-public-key
      tlsFingerprint: "sha256:..."
```

### Systemd Service (Field Node)

For always-on field nodes (e.g., Jetson), install as a systemd user service:

```ini
# ~/.config/systemd/user/clawmesh.service
[Unit]
Description=ClawMesh Field Node
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/jetson/repo/clawmesh
ExecStart=/path/to/tsx clawmesh.ts start --name jetson-field --field-node \
  --sensor-interval 10000 --peer "<mac-deviceId>=ws://<mac-ip>:18789"
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable clawmesh
systemctl --user start clawmesh
systemctl --user status clawmesh
```

## Design Principles

- **Mesh-first**: Peer connectivity and forwarding are first-class primitives
- **Capability-driven**: Route by advertised capabilities, not hard-coded plugin lookups
- **Trust before traffic**: Discovered peers are ignored unless explicitly trusted
- **Local-first**: Always prefer local capabilities over mesh peers
- **Emergent intelligence**: Context gossip builds distributed awareness without central coordination
- **Conversational**: Operators interact via natural language; the planner reasons and proposes
- **Learning mesh**: Approve/reject patterns propagate across nodes, building collective intelligence
- **Lean core**: Small enough to reason about and deploy on edge devices

## Roadmap

- [x] Mesh protocol (mDNS discovery, Ed25519 peer trust, capability routing)
- [x] Emergent context propagation (ContextFrame, WorldModel, gossip)
- [x] Mock sensor / actuator for testing context broadcast
- [x] Pi-powered LLM planner (multi-provider, event-driven, conversational)
- [x] Task proposal queue with approval levels (L0–L3)
- [x] Farm context injection from Bhoomi YAML data
- [x] Pattern learning from operator decisions (PatternMemory + mesh gossip)
- [x] Credential store with auto env-var injection
- [x] Telegram bot channel (long-polling, proposals, alerts)
- [x] TUI dashboard (live peers, gossip, proposals, operator input)
- [x] Web UI dashboard (Next.js — digital twin, command center, telemetry)
- [x] Systemd service for always-on field nodes
- [x] Setup guides for command center and field nodes
- [ ] Real GPIO sensor integration (moisture, temperature, pressure)
- [ ] Build output + npm packaging for the `clawmesh` binary
- [ ] Multi-node end-to-end examples (discovery + trust + forwarding)
- [ ] Capability announcement protocol refinement

## License

MIT
