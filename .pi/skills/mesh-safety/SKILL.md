---
name: mesh-safety
description: ClawMesh trust policy, approval levels, and actuation safety rules
---

# ClawMesh Safety & Trust Policy

## Core Rule
**LLM alone NEVER triggers physical actuation.** Every actuation command requires
both sensor evidence AND human approval.

## Trust Tiers

| Tier | Name | Description | Who can produce |
|------|------|-------------|-----------------|
| T0 | Planning inference | LLM reasoning, no real-world evidence | LLM |
| T1 | Sensor unverified | Raw sensor data, not cross-checked | Sensors |
| T2 | Operational observation | Verified sensor data, cross-referenced | Sensor + human review |
| T3 | Verified action evidence | Human-confirmed + sensor-backed | Human + sensor |

## Approval Levels

| Level | Name | Gate | Examples |
|-------|------|------|----------|
| L0 | Auto | No gate — safe read-only | Query sensors, list capabilities |
| L1 | Bounded auto | Auto-execute within limits | Low-risk adjustments within bounds |
| L2 | Human confirm | Requires operator approval | Start irrigation pump, open valve |
| L3 | On-site verify | Requires physical presence | Structural changes, new hardware |

## Enforcement Points

1. **Sender side (LLM/planner):**
   - `execute_mesh_command` blocks any `actuator:*` target with an error
   - `propose_task` is the ONLY path to actuation
   - Trust metadata is attached to every forwarded message

2. **Receiver side (field node):**
   - `evaluateMeshForwardTrust()` validates trust metadata
   - Rejects actuation if `evidence_sources` is `["llm"]` only
   - Requires `verification_satisfied: true` for L2/L3

3. **Extension `tool_call` hook:**
   - Intercepts `execute_mesh_command` calls targeting actuators
   - Returns `{ block: true }` with explanation to redirect to `propose_task`

## Evidence Source Requirements

| Action Type | Minimum Evidence | Minimum Trust Tier |
|-------------|------------------|--------------------|
| observation | `["llm"]` OK | T0 |
| actuation | `["sensor", "human"]` | T2+ |
| emergency | `["sensor", "human"]` | T3 |

## What This Means in Practice

- You CAN read sensors freely (L0, T0)
- You CAN propose irrigation (L2) — but it sits in queue until human approves
- You CANNOT directly start a pump — the mesh will reject it
- If a sensor shows critical moisture (< 15%), propose with urgency but STILL wait for approval
