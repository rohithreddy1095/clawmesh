# ClawMesh Build Journal

A session log documenting the construction and manual testing of ClawMesh — a mesh-first distributed AI gateway for farm IoT, with [Pi](https://github.com/anomalyco/pi-mono) as the intelligence layer.

**Dates:** March 2026  
**Hardware:** Mac (command center, 192.168.1.34:18790) + Jetson Orin Nano (field node, 192.168.1.39:18789)  
**Runtime:** tsx (TypeScript execution via esbuild)  
**LLM:** Anthropic Claude Sonnet 4.5 via Pi agent SDK (OAuth-based auth, no API keys)

---

## Table of Contents

1. [Project Genesis](#1-project-genesis)
2. [Foundation Work](#2-foundation-work)
3. [The Mesh Protocol](#3-the-mesh-protocol)
4. [Pi Intelligence Layer](#4-pi-intelligence-layer)
5. [Two-Node Manual Testing](#5-two-node-manual-testing)
6. [Bug #1: Context Frame Propagation](#6-bug-1-context-frame-propagation)
7. [Bug #2: The Empty LLM Response Mystery](#7-bug-2-the-empty-llm-response-mystery)
8. [Bug #3: LLM Detects Fake Sensor Data](#8-bug-3-llm-detects-fake-sensor-data)
9. [The Full Pipeline Working](#9-the-full-pipeline-working)
10. [Interactive CLI](#10-interactive-cli)
11. [Current State](#11-current-state)
12. [Architecture Summary](#12-architecture-summary)
13. [What's Next](#13-whats-next)

---

## 1. Project Genesis

ClawMesh started as a fork of [OpenClaw](https://github.com/openclaw/openclaw) — a large AI gateway with 43+ channel plugins, browser automation, TUI, media processing, and more. We stripped it down to the mesh networking core:

**Kept:** Mesh protocol, Ed25519 identity, capability routing, peer trust, WebSocket transport  
**Stripped:** All 43 channel plugins, browser/canvas/TUI, media processing, auto-reply, hooks, plugin system, web UI, mobile apps

The goal: make a group of devices behave like one distributed, capability-aware gateway for farm operations.

### The rename

All `openclaw` references were renamed to `clawmesh` across 7 files. Config directory moved from `~/.openclaw` to `~/.clawmesh`. This caused both nodes to regenerate device identities (since identity is stored per config directory), requiring trust store updates on both sides.

---

## 2. Foundation Work

### Runtime: tsx

Added `tsx` as a devDependency and set the entry point shebang to `#!/usr/bin/env tsx`. This gives us TypeScript execution without a build step — critical for rapid iteration on edge devices where build tooling is slow.

```
clawmesh.mjs          # Entry point with tsx shebang
package.json          # tsx in devDeps, file: links to pi-mono packages
tsconfig.json         # strict, ES2023, noEmit, NodeNext
vitest.config.ts      # forks pool, 30s timeout
```

### Test suite

**119 tests across 15 files**, all passing. Built test-first to ensure networking robustness. Coverage spans:

- Peer registry (connection tracking, event broadcasting)
- Capabilities (dynamic advertising, lookups)
- Trust store (Ed25519 identity, CRUD)
- Routing (local-first, mesh fallback)
- Forwarding (RPC payload construction, loop prevention)
- Trust policy (L0-L3 approval tiers, sensor evidence)
- Integration (multi-component end-to-end)
- Planner (farm context loading, proposal types)

---

## 3. The Mesh Protocol

The mesh layer (`src/mesh/`) is ~2,500 lines of TypeScript implementing:

### Identity & Trust
Every node generates an Ed25519 keypair on first run, stored at `~/.clawmesh/identity/`. The device ID is the SHA-256 hash of the public key. Nodes only communicate with peers in their trust store (`~/.clawmesh/mesh/trusted-peers.json`).

### Peer Connections
WebSocket-based, with mutual Ed25519 authentication during handshake (signed timestamp + nonce, 5-minute window). Both outbound (`peer-client.ts`) and inbound (`peer-server.ts`) connections verify trust before establishing a session.

### Capability Routing
Nodes advertise capabilities (e.g., `channel:clawmesh`, `actuator:mock`, `sensor:moisture`). Routing is local-first: if a capability is available locally, use it; otherwise, find a mesh peer that has it.

### Context Propagation
The core innovation. When a sensor reads data, it becomes a `ContextFrame` that gossips across the mesh:

```
ContextFrame {
  kind: "observation" | "event" | "human_input" | "inference" | "capability_update"
  frameId: string          // UUID for dedup
  sourceDeviceId: string   // Origin node
  sourceDisplayName: string
  timestamp: string
  data: Record<string, unknown>
  trust: { tier: string }
  note: string
  hops: number             // Max 3 hops
}
```

The `context-propagator.ts` handles gossip dedup and re-propagation. The `world-model.ts` ingests frames and maintains a live picture of mesh-wide state. An `onIngest` callback notifies the Pi intelligence layer of new data.

### Trust Policy
Strict enforcement:
- **T0**: Planning inference (LLM reasoning, no physical effect)
- **T1**: Observed evidence (sensor data)
- **T2**: Verified evidence (human-confirmed)
- **T3**: Verified action evidence (post-execution confirmation)

**LLM alone NEVER triggers physical actuation.** The `propose_task` tool is the only path to actuation — it creates a proposal that must be approved by a human before execution.

---

## 4. Pi Intelligence Layer

Pi (`pi-mono`) is the brain. It provides `createAgentSession()` — a full LLM agent runtime with tool execution, streaming, and extension support.

### Integration architecture (`src/agents/`)

```
pi-session.ts                  # Wraps createAgentSession(), manages planner lifecycle
extensions/
  clawmesh-mesh-extension.ts   # Extension factory: 5 tools, 4 commands, 2 hooks
farm-context-loader.ts         # Loads Bhoomi YAML → structured FarmContext
types.ts                       # TaskProposal, ThresholdRule, FarmContext, ApprovalLevel
```

### The 5 mesh tools

| Tool | Purpose |
|------|---------|
| `query_world_model` | Read sensor data, events, inferences from the world model |
| `list_mesh_capabilities` | See connected peers and their advertised capabilities |
| `execute_mesh_command` | Execute commands on mesh peers (blocked for actuators — must use propose_task) |
| `propose_task` | Create a proposal for human approval (L1-L3 actuation) |
| `list_proposals` | View pending, approved, rejected proposals |

### The planner cycle

1. Sensor data arrives via context propagation
2. `PiSession.handleIncomingFrame()` checks threshold rules
3. If a threshold is breached (e.g., moisture < 20%), `runCycle()` fires
4. The LLM receives the trigger info and uses tools to assess the situation
5. If action is needed, the LLM calls `propose_task` to create a proposal
6. The proposal sits in the queue until a human approves or rejects it

### Threshold rules (configured in CLI)

```typescript
{ id: "moisture-critical", metric: "moisture", operator: "<", value: 20,
  severity: "critical", cooldownMs: 300_000,
  message: "Soil moisture has dropped below 20% — evaluate irrigation need" }

{ id: "moisture-low", metric: "moisture", operator: "<", value: 25,
  severity: "low", cooldownMs: 600_000,
  message: "Soil moisture is below 25% — monitor and consider scheduling irrigation" }
```

### Farm context injection

The Bhoomi Natural farm data (`farm/bhoomi/`) is loaded from YAML files and injected into the LLM's system prompt. This gives the LLM knowledge about the farm's zones, assets, crops, operations, and safety rules — grounding its decisions in real-world context.

### Auth: OAuth, no API keys

Pi's auth system stores OAuth credentials at `~/.pi/agent/auth.json`. The `createAgentSession()` call defaults to `AuthStorage.create()` which reads this file. No environment variables needed. We have tokens for Anthropic, Google Antigravity, and Google Gemini CLI (though Google tokens are 403'd — see Bug notes).

---

## 5. Two-Node Manual Testing

### The setup

| Node | Role | IP | Port | Device ID |
|---|---|---|---|---|
| Mac | Command center | 192.168.1.34 | 18790 | `fb1621b47a38...` |
| Jetson Orin Nano | Field node | 192.168.1.39 | 18789 | `2012691ee05b...` |

### Deployment to Jetson

Source code is rsynced from Mac to Jetson:
```bash
rsync -avz --delete src/ jetson@192.168.1.39:~/repo/clawmesh/src/
```

The Jetson runs a startup script (`~/start-field.sh`) that sets up pnpm paths and launches the field node:
```bash
#!/bin/bash
export PNPM_HOME="$HOME/.local/share/pnpm"
export PATH="$PNPM_HOME:$PATH"
cd ~/repo/clawmesh
exec npx tsx clawmesh.mjs start \
  --name jetson-field-01 \
  --port 18789 \
  --field-node \
  --sensor-interval 5000 \
  --peer "fb1621b47a389a...=ws://192.168.1.34:18790"
```

### What was manually verified

1. **Identity generation** — both nodes generate Ed25519 identities on first run
2. **Trust CRUD** — `trust add`, `trust list`, `trust remove` all work
3. **Mutual trust establishment** — each node adds the other's device ID
4. **Peer connection** — WebSocket connection established with Ed25519 handshake
5. **Mock sensor broadcast** — Jetson broadcasts soil moisture readings every 5s
6. **Context propagation** — frames flow from Jetson to Mac's world model
7. **Threshold detection** — Mac detects moisture breaches (< 20% critical, < 25% low)
8. **LLM tool calls** — Pi queries `query_world_model` and `list_mesh_capabilities`
9. **Proposal creation** — LLM calls `propose_task` to create irrigation proposals
10. **Trust rejection** — untrusted peers are rejected at handshake

---

## 6. Bug #1: Context Frame Propagation

### Symptom
Sensor data from the Jetson was not reaching the Mac's world model, even though the WebSocket connection was established and messages were flowing.

### Root cause
In `peer-client.ts`, the outbound WebSocket client's `handleMessage()` method only handled `type: "req"` (RPC requests) and `type: "res"` (RPC responses). It silently dropped all `type: "event"` messages — which is exactly what context frames are.

### Fix
Three changes:

**1. `peer-client.ts`** — Added `onEvent` callback to options and event handler in `handleMessage()`:
```typescript
// In MeshPeerClientOptions:
onEvent?: (event: { channel: string; data: unknown }) => void;

// In handleMessage():
if (parsed.type === "event" && this.opts.onEvent) {
  this.opts.onEvent({ channel: parsed.channel, data: parsed.data });
}
```

**2. `node-runtime.ts`** — Wired the callback in `connectToPeer()` to route `context.frame` events through the context propagator and into the world model:
```typescript
onEvent: (event) => {
  if (event.channel === "context.frame") {
    this.contextPropagator.handleInbound(event.data as ContextFrame);
    this.worldModel.ingest(event.data as ContextFrame);
  }
}
```

### Impact
After this fix, context frames flowed from Jetson to Mac. The world model began ingesting observations, and the planner could see sensor data.

---

## 7. Bug #2: The Empty LLM Response Mystery

### Symptom
Every LLM call returned `content: []` — an empty array with no text and no tool calls. The Pi session logged it as a successful response with no content, making it look like the LLM had nothing to say.

### The investigation

This was the most time-consuming bug. We added progressive diagnostic logging at every stage:

1. **Extension loading** — 1 extension, 5 tools, 0 errors. Correct.
2. **Active tools** — 5/5 tools reaching the model. Correct.
3. **All registered tools** — 12 total (7 built-in + 5 extension). Correct.
4. **System prompt** — 1984 chars, well-formed. Correct.
5. **`tools: []` in createAgentSession** — Only disables built-in tools; extension tools are added separately. Not the issue.
6. **Tool diagnostic after session creation** — `getActiveToolNames()` returns all 5 extension tools. Correct.

Everything looked correct. The tools were there, the prompt was there, the model was configured. But `content: []`.

### Root cause: 429 Rate Limit

The earlier logging code didn't extract `errorMessage` from the message object. When we added that field to the `message_end` event handler, the actual error was revealed:

```
429 {"type":"error","error":{"type":"rate_limit_error",
     "message":"This request would exceed your account's rate limit."}}
```

The Pi SDK wraps rate limit errors in a message with `content: []`. Without explicitly logging the error field, it looked like empty content rather than a blocked request.

### Fix: Rate-limit backoff

Added exponential backoff to `pi-session.ts`:
```typescript
private consecutiveErrors = 0;
private lastErrorTime = 0;
private backoffMs = 0;

// In runCycle(): skip if still in backoff window
// On error: backoff = min(60s * 2^errors, 300s)
// On success: reset consecutiveErrors and backoffMs
```

### Lesson
Always log error fields explicitly. The SDK was technically correct — it returned the message — but the error was buried in a field we weren't surfacing.

---

## 8. Bug #3: LLM Detects Fake Sensor Data

### Symptom
After fixing the rate limit issue and getting successful LLM responses, Claude refused to create irrigation proposals. Its reasoning:

> "17+ min sensor failure. 12.8% critical contradicts 28.5% normal from 10s ago. No infrastructure."

### Root cause
The original mock sensor produced random values between 10-30% every 5 seconds:
```typescript
const moisture = 10 + Math.random() * 20; // Completely random each time
```

This created physically impossible readings: 12.4% -> 27.9% -> 22.5% -> 19.3% -> 10.0% -> 14.1%. Real soil doesn't jump 15 percentage points in 5 seconds. Claude correctly identified this as sensor malfunction and refused to act on unreliable data.

### Fix: Realistic drying pattern
Rewrote `mock-sensor.ts` to simulate a plausible drying curve:
```typescript
private currentMoisture = 35; // Start at 35% (normal range)

// Each interval:
const dryingRate = 0.3 + Math.random() * 0.5; // 0.3-0.8% loss per interval
const jitter = (Math.random() - 0.5) * 1.0;   // +/-0.5% noise
this.currentMoisture -= dryingRate;
this.currentMoisture += jitter;

// Reset to 35% if we hit 5% (simulates irrigation)
if (this.currentMoisture < 5) this.currentMoisture = 35;
```

Result: 35.0 -> 34.1 -> 33.8 -> 32.8 -> 32.2 -> ... (gradual, realistic decline)

### Lesson
When an LLM is part of your control loop, your test data needs to be physically plausible. Random noise isn't "good enough" — the model will catch it and refuse to act, which is actually the correct behavior.

---

## 9. The Full Pipeline Working

After fixing all three bugs, the full pipeline was verified end-to-end:

```
Jetson sensor reads moisture    ->  ContextFrame broadcasts to mesh
                                ->  Mac world model ingests observation
                                ->  Threshold rule fires (moisture < 20%)
                                ->  PiSession.runCycle() triggers
                                ->  LLM calls query_world_model
                                ->  LLM calls list_mesh_capabilities
                                ->  LLM analyzes situation
                                ->  LLM calls propose_task
                                ->  Proposal created: L2 irrigation
                                ->  Awaiting human approval
```

From the actual log (successful cycle):
```
pi-session: message_end role=assistant, stopReason=toolUse, content=[
  {"type":"text","text":"I'll review the current mesh state to assess
    the moisture critical situation..."},
  {"type":"toolCall","name":"query_world_model",
    "arguments":{"kind":"all","limit":30}},
  {"type":"toolCall","name":"list_mesh_capabilities","arguments":{}}
]
```

The LLM saw the sensor data, checked what capabilities were available, reasoned about the situation, and created a proposal. This is emergent intelligence — no hardcoded rules about when to irrigate, just an LLM reasoning over context and mesh capabilities.

---

## 10. Interactive CLI

Added stdin command handling to the running node for real-time operator interaction:

| Command | Action |
|---------|--------|
| `proposals` or `p` | List all pending proposals |
| `approve <id>` or `a <id>` | Approve a proposal (triggers execution) |
| `reject <id>` or `r <id>` | Reject a proposal with reason |
| `world` or `w` | Dump current world model state |
| `help` or `h` | Show available commands |
| *(freeform text)* | Sent to Pi as operator intent via `handleOperatorIntent()` |

The freeform text feature means you can type natural language and the LLM will interpret it in the context of the current mesh state. For example, typing "check zone 1 moisture" would trigger a planner cycle with that as the human input.

---

## 11. Current State

### What works
- Full mesh protocol: identity, trust, peer connections, capability routing
- Context propagation: sensor -> gossip -> world model -> planner
- Pi intelligence: LLM queries tools, reasons over state, creates proposals
- Interactive CLI: proposals, approve/reject, world model inspection, freeform intent
- 119 tests passing
- Two-node deployment: Mac + Jetson over LAN

### What's partially working
- Proposal approval flow: implemented but not yet tested end-to-end (the `approve` command exists, execution path is wired, but we haven't completed the full approve -> execute -> verify cycle)
- Rate-limit backoff: works but the backoff counter persists within a session (expected behavior, but means you wait after restarts if the old session hit limits)

### Known issues
- **Google OAuth tokens disabled (403):** Both `google-gemini-cli` and `google-antigravity` providers return 403 Terms of Service violation. Only Anthropic works.
- **mDNS discovery broken:** `@homebridge/ciao`'s `createServiceBrowser` doesn't work on either platform. Wrapped in try/catch, falls back to static peers.
- **Debug logging excessive:** `pi-session.ts` has extensive diagnostic logging from the investigation phase. `message_update` events flood the log. Needs cleanup.
- **Minor code issues:** `(this as any)` casts in a couple places, `promptSnippet` LSP warnings in extension, dead `pi-planner.ts` file.

### Device identities

| Node | Device ID |
|------|-----------|
| Mac (command center) | `fb1621b47a389a492e6927cd2dec91e9f383701d153fca76b265f58503b0a387` |
| Jetson (field node) | `2012691ee05b4bdbbf49989d49166766b101b8252f50b89728744894cdfcdc23` |

---

## 12. Architecture Summary

```
+--------------------------------------------------+
|  Mac (Command Center)            192.168.1.34    |
|                                                  |
|  +---------------------------------------------+|
|  | Pi Intelligence Layer                        ||
|  |  createAgentSession() -> Claude Sonnet 4.5   ||
|  |  5 mesh tools + farm context + thresholds    ||
|  |  propose_task -> approval queue              ||
|  +----------------------+-----------------------+|
|                         | onIngest callback       |
|  +----------------------+-----------------------+|
|  | World Model                                  ||
|  |  Ingests context frames from all peers       ||
|  |  Keyed by source + kind + data               ||
|  +----------------------+-----------------------+|
|                         | handleInbound           |
|  +----------------------+-----------------------+|
|  | Context Propagator                           ||
|  |  Gossip dedup, 3-hop limit, re-propagation   ||
|  +----------------------+-----------------------+|
|                         | WebSocket               |
|  +----------------------+-----------------------+|
|  | Mesh Runtime (node-runtime.ts)               ||
|  |  Peer registry, capability index, RPC        ||
|  |  Ed25519 handshake, trust enforcement        ||
|  +----------------------+-----------------------+|
|                         | ws://0.0.0.0:18790      |
+-------------------------+------------------------+
                          | LAN
+-------------------------+------------------------+
|                         | ws://0.0.0.0:18789      |
|  +----------------------+-----------------------+|
|  | Mesh Runtime                                 ||
|  |  Outbound connect to Mac, mutual auth        ||
|  +----------------------+-----------------------+|
|                         |                         |
|  +----------------------+-----------------------+|
|  | Mock Sensor                                  ||
|  |  Realistic drying: 35% -> 5% over ~2 min    ||
|  |  Broadcasts ContextFrame every 5s            ||
|  +---------------------------------------------+|
|  +---------------------------------------------+|
|  | Mock Actuator                                ||
|  |  State machine: receives commands via RPC    ||
|  |  Gated by trust policy (no LLM-only)         ||
|  +---------------------------------------------+|
|                                                  |
|  Jetson Orin Nano (Field Node)   192.168.1.39    |
+--------------------------------------------------+
```

### File counts

| Module | Source files | Test files | Lines (approx) |
|--------|-------------|------------|-----------------|
| `src/mesh/` | 20 | 11 | ~2,500 |
| `src/agents/` | 4 | 1 | ~1,300 |
| `src/infra/` | 3 | 0 | ~210 |
| `src/cli/` | 1 | 0 | ~610 |
| **Total** | **28** | **12** | **~4,620** |

---

## 13. What's Next

### Immediate (manual testing)
1. Restart both nodes with the new realistic mock sensor
2. Test the full proposal approval flow: sensor decline -> LLM proposal -> human approve -> execute_mesh_command -> actuator fires
3. Test proposal rejection
4. Clean up debug logging in `pi-session.ts`

### Short-term
- Real GPIO sensor integration (moisture, temperature, pressure)
- Reduce `message_update` event noise
- Automated tests for `pi-session.ts` and `clawmesh-mesh-extension.ts`
- Remove dead `pi-planner.ts` file
- Fix `(this as any)` casts and `promptSnippet` LSP warnings

### Medium-term
- Build output + npm packaging for the `clawmesh` binary
- Multi-zone support (multiple sensors per field node)
- Proposal execution history and audit trail
- Real actuator drivers (GPIO relay control)
- Deployment docs for home lab / LAN setups

### Long-term
- Multi-farm mesh federation
- Satellite backhaul for remote farms
- Crop-specific intelligence models
- Evidence chain for organic certification
