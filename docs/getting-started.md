# ClawMesh Getting Started Guide

ClawMesh is a mesh-first AI gateway designed for distributed, capability-aware operations (e.g., smart farming). It connects various nodes into a single, cohesive P2P mesh network where context (sensor data, events, intents) is propagated automatically, and decisions are made locally or via a command center.

## Core Concepts

1. **Nodes & Capabilities**: Every device running ClawMesh is a node. Nodes advertise their capabilities (e.g., `sensor:moisture:zone-1`, `actuator:pump:P1`, `skill:intelligence`).
2. **Identity & Trust**: Every node has an Ed25519 identity. Nodes only communicate with peers they explicitly trust.
3. **World Model**: Each node maintains a local "world model" populated by context frames (sensor readings, events, inference) gossiped across the network.
4. **Intelligence Layer**: Powered by Pi (`pi-coding-agent`), command center nodes can run an LLM-powered planner that reads the world model and proposes actions.
5. **Trust Policy**: Strict L0-L3 approval levels. An LLM alone NEVER triggers physical actuation without human approval and sensor evidence.

## System Requirements

- **Node.js**: v22+
- **Package Manager**: pnpm (v10+)
- **Network**: Local Area Network (LAN) supporting mDNS for auto-discovery (or static IPs for manual peering).

## Quick Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/your-org/clawmesh.git
cd clawmesh
pnpm install
```

## Node Types

While any node can run any capability, a typical deployment has two types of nodes:

### 1. Command Center (e.g., Mac/PC)
Runs the dashboard UI, the Pi intelligence layer (LLM), and acts as the brain.
- **Capabilities**: `skill:intelligence`
- **Role**: Ingests mesh data, runs the planner loop, creates proposals, provides UI.
- [Setup Command Center Guide](./setup-command-center.md)

### 2. Field Node (e.g., Jetson Orin, Raspberry Pi)
Sits in the field, reads sensors, controls actuators. Does not need an LLM.
- **Capabilities**: `sensor:*`, `actuator:*`
- **Role**: Broadcasts sensor data to the mesh, executes approved actuation commands.
- [Setup Field Node Guide](./setup-field-node.md)

## Next Steps

1. Read the [Command Center Setup](./setup-command-center.md).
2. Read the [Field Node Setup](./setup-field-node.md).
3. Review the [Trust & Safety Policy](../.pi/skills/mesh-safety.md) to understand how actuation is gated.
