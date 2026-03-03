---
name: mesh-operations
description: How to use ClawMesh mesh tools — capability refs, sensor data, proposal workflow
---

# ClawMesh Mesh Operations Guide

## Tool Usage Workflow

### Step 1: Understand current state
```
query_world_model(kind: "all", limit: 20)
```
Returns recent sensor observations, events, human inputs, and inference frames
from all connected mesh nodes.

### Step 2: Discover what's available
```
list_mesh_capabilities()
```
Returns connected peers, their device IDs, display names, and advertised capabilities.

### Step 3: Execute read-only operations (L0)
```
execute_mesh_command(
  targetRef: "sensor:moisture:zone-1",
  operation: "read",
  reasoning: "Checking current soil moisture before deciding on irrigation"
)
```
Only for `sensor:*` targets. Any `actuator:*` target will be blocked.

### Step 4: Propose actuation (L2+)
```
propose_task(
  summary: "Start pump P1 for zone-1 irrigation",
  reasoning: "Moisture at 14% — below 20% critical threshold per sensor:moisture:zone-1",
  targetRef: "actuator:pump:P1",
  operation: "start",
  operationParams: { durationSec: 1800 },
  approvalLevel: "L2"
)
```
This enters the proposal queue. Human must approve before execution.

### Step 5: Check proposal status
```
list_proposals(status: "awaiting_approval")
```

## Capability Reference Format

Capabilities follow a colon-separated namespace:
```
sensor:moisture:zone-1        — Soil moisture sensor in zone-1
sensor:temperature:ambient     — Ambient temperature sensor
actuator:pump:P1               — Irrigation pump P1
actuator:valve:V1              — Irrigation valve V1
channel:clawmesh               — Basic mesh connectivity
skill:intelligence             — Intelligence/planner capability
```

## Sensor Data Interpretation

Sensor observations arrive as `ContextFrame` with `kind: "observation"`:
```json
{
  "kind": "observation",
  "data": {
    "metric": "moisture",
    "zone": "zone-1",
    "value": 23.4,
    "unit": "%"
  },
  "sourceDeviceId": "jetson-field-01",
  "timestamp": 1709500000000
}
```

### Key Metrics
| Metric | Unit | Critical Low | Warning Low | Normal Range |
|--------|------|-------------|-------------|--------------|
| moisture | % | < 15 | < 20 | 25–60 |
| temperature | °C | < 5 (frost) | < 10 | 15–35 |

## Proposal Queue Workflow

```
Trigger (sensor/operator/schedule)
  → LLM analyzes with query_world_model
  → LLM calls propose_task (L1/L2/L3)
  → L1: auto-approved, executes immediately
  → L2: enters queue, awaits operator approval
  → L3: enters queue, requires physical on-site verification
  → Operator approves/rejects via UI or /approve /reject commands
  → If approved: execution → result broadcast → proposal marked complete
```

## Farm Operations Library (from `farm/bhoomi/operations/library.yaml`)

| Operation | Approval | Description |
|-----------|----------|-------------|
| Jeevamrit Application | L1 | Apply fermented biofertilizer |
| Irrigation Start | L2 | Start irrigation for a zone |
| Irrigation Stop | L1 | Stop irrigation (safe) |
| Sensor Calibration | L3 | Recalibrate field sensors |
| Emergency Shutoff | L2 | Emergency stop all pumps |
