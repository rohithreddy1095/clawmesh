# ClawMesh Architecture Vision: Emergent Intelligence Mesh

ClawMesh represents a fundamental evolution from a traditional centralized gateway (like OpenClaw) into a sovereign, intelligent mesh network where knowledge is emergent rather than statically synchronized.

## The Core Vision
ClawMesh is not about syncing files across machines or statically watching directories. It is about **emergent context and distributed execution**. 

If you modify farm data or a system parameter while in the field, your Jetson Nano instantly knows it. That knowledge organically propagates through the mesh to your Mac. When the Mac's Planner LLM suggests the next farm operation, it inherently understands the Jetson's new context and can seamlessly forward the execution back to the Jetson to carry it out.

The mesh builds itself dynamically as nodes interact, observe, and compute.

## Core Pillars
1. **The Mesh IS the Gateway**
   Nodes discover each other natively via a `_clawmesh._tcp` Bonjour service, leaving the legacy OpenClaw hierarchy behind.

2. **Liquid Execution & Emergent Context**
   Context is not explicitly "pushed" via git or file watchers. Instead, context is built from live operations, sensor readings, and human inputs happening on any node.
   - Example: Jetson learns the soil is heavily depleted based on a field test. It broadcasts this context state (`zone-1:moisture-critical`).
   - The Mac receives this and updates its planner state.
   - The Jetson advertises an execution capability (`actuator:pump:P1`).

3. **Intelligent Orchestration (Pi-Mono)**
   Nodes with intelligence capabilities (like a Gateway running `pi-mono` or the Mac Planner) use the continuously updating mesh capability registry to orchestrate tasks. The Mac reasons over the emergent context and forwards an execution command back to the Jetson to run the pump.

## Key Mechanisms
* **Advanced Capability & Context Advertisement:** Expanding the registry to handle capability objects (tools, LLMs) and live, emergent context frames (observations, state changes) rather than static strings.
* **Distributed Execution Forwarding:** Using the mesh command envelope to securely route tool execution requests to the nodes where they physically need to run.
* **Continuous Context Gossip:** Broadcasting local state changes, observations, and inferred facts over WebSockets so peers are always up-to-date without polling.
