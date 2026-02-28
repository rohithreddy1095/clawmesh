# BhoomiNatural Farm Twin Spec v0

Status: Draft (working spec)

Date: 2026-02-26

Primary goal: define a farm intelligence + mesh execution system for Bhoomi Natural, where a Mac-based planner agent and a Jetson Nano field agent coordinate trusted devices ("claws") and human work to operate a food forest safely and effectively.

## 1. Purpose

This spec defines the structure for a `Farm Twin` that can:

- represent the real farm (land, zones, water, crops, infrastructure, operations)
- support research and planning (what can grow, what to try, when to do work)
- support mesh execution (Jetson + field nodes + actuators/sensors)
- keep humans in the loop for approvals, field work, and verification

This is not just an irrigation automation spec. It is a farm operating system spec.

## 2. Scope (v0)

Included in v0:

- Bhoomi Natural main farm baseline representation (Shamli, UP)
- farm entities and state model
- operation/task model (human + machine + hybrid)
- mesh capability namespace and role split (Mac / Jetson / field nodes)
- evidence and verification model
- safety constraints and approval policy
- research/trial workflow structure for crop expansion

Not included in v0:

- final hardware bill of materials
- exact sensor brand choices
- exact field wiring diagrams
- UI design details
- autonomous decision policies without human override

## 3. Evidence Base (Repository-Derived)

This draft is grounded in BhoomiNatural repository content, especially:

- website process and food-forest structure in ` /Users/rohhh/repo/bhoominatural/website/index.html`
- location/project summaries in `/Users/rohhh/repo/bhoominatural/website/data/locations.json`
- YouTube analysis metadata and structured extraction in `/Users/rohhh/repo/bhoominatural/refs/youtube/analysis/`
- Bhoomi analysis workflow docs in `/Users/rohhh/repo/bhoominatural/.claude/commands/bhoomi.md` and `/Users/rohhh/repo/bhoominatural/.claude/commands/bhoomi-analyze.md`

Working facts pulled from repo:

- Bhoomi Natural describes a `10-acre` main farm in Shamli, Uttar Pradesh, with no-till, chemical-free, multilayer food-forest practice.
- Website process steps include:
  - assess land
  - no-till foundation
  - mulch & cover
  - invite earthworms
  - apply Jeevamrit
  - plant in layers
- The site and data list diverse crop/output categories (fruits, flowers, spices/grains, value-added products).
- `refs/youtube/analysis/summary.json` reports `46` videos with categories across farm tour / tutorial / harvest / transformation / general.
- `refs/youtube/analysis/extracted_data.json` contains structured extraction for `21` analyzed videos.
- `refs/youtube/analysis/locations.json` groups project videos across `Mumbai`, `Kolkata`, `Main Farm (Shamli)`, `Noida`, `Delhi`, `Konkan`, and `Dehradun`.

Derived (local parse on 2026-02-26) from `extracted_data.json`, Shamli subset:

- `21` Shamli-analyzed videos
- frequent techniques: `Food Forest`, `Jeevamrit`, `Vermicompost`, `Grafting`, `Multilayer`
- frequent crops mentioned: `Litchi`, `Mango`, `Flowers`, `Peach`, `Turmeric`, `Pear`, `Banana`, `Guava`, `Tuberose`, `Chiku`, `Papaya`
- recurring operational themes: pruning, composting, harvest/packaging, bee decline, irrigation/water-saving, pineapple/turmeric intercropping

Data quality notes (important for agent reasoning):

- aggregate JSON files are the most reliable structured sources in the repo
- per-video markdown analyses vary in detail (some are sparse if transcript/description content was limited)
- recommendations generated from video data should be labeled as `inference` until field-verified

## 4. System Vision (Mac + Jetson + Claws + Human)

### 4.1 Roles

- `Mac Agent` (planner / researcher / operator console)
  - long-range planning
  - research and recommendations
  - scheduling and task orchestration
  - audit/history review
  - human approval interface

- `Jetson Nano Agent` (field brain)
  - local execution orchestration
  - low-latency control loops
  - local sensor fusion / camera inference
  - safety interlocks
  - offline-first behavior when network is down

- `Field Claws` (mesh peers in the real world)
  - sensors (soil moisture, tank level, weather, flow, pressure, cameras)
  - actuators (valves, pumps, relays, dosing, alarms)
  - edge helpers (camera nodes, gateway repeaters)

- `Human Operator` (you + farm team)
  - field verification
  - physical interventions
  - exception handling
  - training the system with ground-truth observations
  - final approval for high-risk actions

### 4.2 Core Principle

No action is considered complete until it is:

- `acknowledged` by the responsible node, and
- `verified` by sensor evidence or human confirmation

## 5. Farm Twin Data Model (v0)

The Farm Twin is a set of linked entities with state, history, and evidence.

### 5.1 Site Profile

Represents the farm as a whole.

Fields:

- `site_id`
- `name`
- `location` (village/district/state/country)
- `lat_lon` (optional until measured)
- `area_acres`
- `climate_notes`
- `farming_principles` (no-till, chemical-free, multilayer, etc.)
- `operator_contacts`
- `languages_used` (Hindi/English, etc.)

### 5.2 Zones and Subzones

Physical partitioning for operations and planning.

Entity examples:

- orchard blocks
- flower strips
- rice patch
- nursery
- compost area
- Jeevamrit prep area
- pump house
- tank area
- packing area
- beekeeping area
- trials area

Required fields:

- `zone_id`
- `name`
- `zone_type`
- `parent_zone_id` (optional)
- `area_sq_m` or `approx_area`
- `boundaries` (GPS polygon later; sketch now)
- `soil_profile_ref`
- `water_access_ref`
- `shade_profile`
- `current_use`
- `constraints`

### 5.3 Infrastructure Assets

Track things that can fail, need maintenance, or be controlled.

Asset classes:

- water source / borewell / pond
- tanks
- pumps
- mainline / sublines
- valves
- filters
- power source / inverter / solar / battery
- camera poles / sensor posts
- storage / packing stations

Required fields:

- `asset_id`
- `asset_type`
- `location_zone_id`
- `specs` (capacity, voltage, flow, pipe size, etc.)
- `status`
- `manual_controls`
- `mesh_capabilities` (if connected)
- `maintenance_schedule`
- `failure_modes`

### 5.4 Water System Model

This is a first-class model, not just a sensor list.

Represent:

- sources
- storage
- distribution topology
- flow constraints
- zone-level water demand estimates
- seasonal water availability
- pump runtime limits
- manual override points

Minimum v0 objects:

- `WaterSource`
- `Tank`
- `Pump`
- `Valve`
- `IrrigationLine`
- `IrrigationPlan`
- `WaterEvent`

### 5.5 Soil and Biology Model

Represent the living system, not only crops.

Entities:

- soil profile per zone (texture, drainage, compaction, organic matter notes)
- mulch state
- microbial support practices (Jeevamrit / Ghanjeevamrit / compost)
- earthworm activity observations
- pollinator observations (bees, decline events)

Fields should support:

- qualitative notes (human observations)
- quantitative sensor data (later)
- evidence attachments (images, videos, logs)

### 5.6 Crop and Layer Inventory

Track what exists now and what is planned.

Entity: `PlantUnit` (tree row, patch, bed, cluster, or individual tree)

Fields:

- `plant_unit_id`
- `zone_id`
- `layer` (`canopy`, `subcanopy`, `shrub`, `ground`, `root/soil`, `support`)
- `crop_species`
- `variety`
- `count`
- `age_stage` (new planting / vegetative / flowering / fruiting / post-harvest / dormant)
- `companion_relationships`
- `health_status`
- `last_observation_at`
- `expected_season_window`
- `harvest_notes`

### 5.7 Operations Library

A reusable catalog of farm practices and workflows.

Seed Bhoomi operations (from site + video analysis):

- land assessment
- no-till foundation setup
- mulching and cover layering
- earthworm support / observation
- Jeevamrit application
- Ghanjeevamrit / compost application
- pruning after harvest
- grafting
- multilayer planting
- irrigation channel/water-saving setup
- flower harvesting and packaging (e.g., Gladiolus)
- fruit harvesting
- pest/pollinator scouting (including bee decline incidents)

Each operation definition should include:

- `operation_id`
- `name`
- `purpose`
- `trigger_conditions`
- `preconditions`
- `required_roles` (`human`, `jetson`, `field_node`, `hybrid`)
- `steps`
- `evidence_required`
- `safety_constraints`
- `rollback_or_recovery`

### 5.8 Task / Work Order Model

Tasks are runtime instances of operations.

Task types:

- `human_task`
- `machine_task`
- `hybrid_task`
- `inspection_task`
- `research_task`

Task lifecycle:

- `proposed`
- `approved`
- `scheduled`
- `dispatched`
- `in_progress`
- `blocked`
- `awaiting_verification`
- `completed`
- `failed`
- `cancelled`

Every task must record:

- who/what requested it
- who approved it
- who executed it
- evidence
- outcome
- follow-up tasks (if any)

### 5.9 Observations, Events, and Evidence

This is the memory layer of the farm.

Observation sources:

- human note
- human photo/video
- sensor reading
- camera inference
- derived estimate (e.g., likely water stress)
- external input (weather)

Event examples:

- `tank_level_low`
- `pump_started`
- `valve_opened`
- `zone_irrigation_completed`
- `flowering_observed`
- `bee_activity_drop`
- `disease_suspected`
- `harvest_completed`

Evidence objects should support:

- timestamp
- source
- confidence
- linked zone/asset/plant units
- raw payload reference
- summary text

### 5.9.1 Evidence Trust Policy (Core Rule)

LLM-generated outputs (including design reports, summaries, and recommendations) are useful for planning, but they are **not trusted as execution truth**.

Execution trust should come from:

- on-farm sensors and device telemetry
- device acknowledgements and state feedback
- human observations / confirmations

Trust tiers (v0):

- `T0_planning_inference`:
  - LLM reports, design concepts, extracted summaries, external research hypotheses
  - allowed for planning and question generation only
  - not sufficient for autonomous actuation
- `T1_unverified_observation`:
  - raw sensor/device/human data not yet validated (new sensor install, uncertain provenance, stale reading)
  - allowed for alerts and human review
  - not sufficient for high-risk actuation
- `T2_operational_observation`:
  - known device telemetry / calibrated sensor readings / routine human observations
  - allowed for bounded low-risk workflows with policy checks
- `T3_verified_action_evidence`:
  - cross-checked sensor signals and/or human confirmation proving an action occurred correctly
  - required to close critical tasks and validate execution

Design rule:

- every observation/evidence record should carry a trust tier
- command policies must declare the minimum trust tier required

### 5.10 Research and Trial Model

The system must support learning what can grow and how to improve outcomes.

Entity: `Trial`

Fields:

- `trial_id`
- `hypothesis`
- `zone_id`
- `species_variety`
- `companion_plan`
- `resource_budget` (water/labor/input)
- `success_metrics`
- `observation_schedule`
- `risks`
- `human_owner`
- `status`
- `result_summary`

Research outputs should always distinguish:

- `evidence-backed recommendation`
- `inference / hypothesis`
- `field-verified result`

## 6. Mesh Capability Model (ClawMesh-Aligned)

### 6.1 Capability Naming Convention (v0)

Capability IDs should be explicit and composable:

- `sensor:soil-moisture:<zone_id>`
- `sensor:soil-temp:<zone_id>`
- `sensor:air-temp:<zone_id>`
- `sensor:humidity:<zone_id>`
- `sensor:tank-level:<tank_id>`
- `sensor:flow:<line_id>`
- `sensor:power:<asset_id>`
- `vision:plant-health:<zone_id>`
- `vision:pollinator-activity:<zone_id>`
- `actuator:valve:<valve_id>`
- `actuator:pump:<pump_id>`
- `actuator:relay:<relay_id>`
- `actuator:alarm:<alarm_id>`
- `planner:irrigation`
- `planner:seasonal`
- `planner:trial-design`
- `task:human-field-check`
- `task:harvest-workflow`
- `knowledge:crop-suitability`

### 6.2 Node Role Profiles

- `mac-main`
  - `planner:*`
  - `knowledge:*`
  - `task:*`
  - `operator-console:*` (future)

- `jetson-field-01`
  - `planner:irrigation`
  - `vision:*`
  - `safety:interlock`
  - `exec:workflow`

- `field-node-water-01`
  - `sensor:tank-level:*`
  - `sensor:flow:*`
  - `actuator:pump:*`
  - `actuator:valve:*`

- `field-node-weather-01`
  - `sensor:rain`
  - `sensor:wind`
  - `sensor:air-temp:*`
  - `sensor:humidity:*`

- `human-mobile`
  - `task:human-field-check`
  - `observe:photo`
  - `observe:note`
  - `approve:low-risk` (optional)

## 7. Command, State, and Verification Contracts (v0)

ClawMesh should carry structured farm messages, not ad-hoc text only.

### 7.1 Command Envelope (conceptual)

Fields:

- `command_id`
- `requested_by`
- `approved_by` (if needed)
- `target_capability`
- `target_node` (optional if routed by capability)
- `operation_ref`
- `task_ref`
- `parameters`
- `constraints`
- `issued_at`
- `expiry_at`

### 7.2 Execution Acknowledgement

Each node returns:

- `accepted` / `rejected`
- `reason` (if rejected)
- `estimated_start`
- `safety_checks_applied`

### 7.3 Verification Record

A command is complete only with one or more:

- sensor verification
- camera verification
- human confirmation
- timeout/failure report

Examples:

- pump start verified by `power + flow`
- irrigation completion verified by `runtime + flow + valve state`
- pruning completed verified by `human photo + checklist`
- bee issue investigation verified by `human observation + image/video`

### 7.4 Actuation Gating by Trust Tier

LLM-derived content must not directly trigger physical actions.

Examples:

- `allowed`: LLM suggests irrigation timing or crop trial ideas -> system creates `proposed` tasks/questions
- `not allowed`: LLM recommendation directly starts pump/opens valve without trusted current farm state
- `allowed with policy`: Jetson executes bounded irrigation only when minimum required sensor/device trust signals are present

## 8. Safety and Human-in-the-Loop Policy

### 8.1 Safety Invariants (must never be violated)

- no pump run without valid water source/tank condition
- no irrigation beyond zone max runtime / max volume without renewed approval
- no actuator action when communication state is unknown and local safety state is unsafe
- default fail-safe state for valves/pumps on controller restart
- manual override always takes priority
- no physical actuation triggered solely by LLM-generated inference/report content

### 8.2 Approval Levels

- `L0` auto-allowed (telemetry reads, low-risk observations)
- `L1` Jetson auto-exec with policy (short irrigation cycles within limits)
- `L2` human confirmation required (long runs, new zones, trial dosing)
- `L3` explicit on-site verification required (electrical, plumbing, invasive interventions)

### 8.3 Degraded Modes

- `offline_mac`: Jetson continues safe local schedules and buffering
- `offline_jetson`: field nodes fall back to local safe defaults, no complex tasks
- `sensor_fault`: switch to human inspection tasks
- `power_unstable`: suspend nonessential operations

## 9. Bhoomi Natural Baseline (Prefill v0)

This section is intentionally incomplete; it is the starting state for field validation.

### 9.1 Site Snapshot (Known)

- Farm name: `Bhoomi Natural`
- Main site: `Shamli district, Uttar Pradesh, India`
- Main farm size: `~10 acres`
- Farming principles:
  - no-till
  - chemical-free
  - multilayer food forest
  - biodiversity-oriented

### 9.2 Process Backbone (Known)

Current stated process (website):

1. Assess land (soil, water table, vegetation, sun)
2. Build no-till foundation
3. Mulch and cover soil
4. Support earthworms
5. Apply Jeevamrit
6. Plant in layers

### 9.3 Layered Production Model (Known)

Website examples:

- canopy: Mango, Litchi
- sub-canopy: Avocado, Papaya, Jackfruit
- shrub layer: Gladiolus, Tuberose
- ground cover: Turmeric, Pineapple
- soil/root zone: Earthworms, microbes

### 9.4 Crops and Outputs Mentioned in Repo (Known)

From website and video analysis data, the farm ecosystem includes:

- fruits: mango, litchi, guava, papaya, banana, peach, pear, chiku, jackfruit, pineapple, avocado
- flowers: gladiolus, tuberose / rajnigandha
- spices/grains: turmeric, rice (including black rice / desi varieties)
- value-added: honey, pickle, dried fruits

### 9.5 Operational Themes Observed in Video Dataset (Known)

- irrigation cost/water saving techniques
- Jeevamrit / Gokripamrit / Ghanjeevamrit usage
- composting and pruning after harvest
- grafting and variety development (mango)
- flower harvest and packaging workflows
- pollinator stress / bee decline issue tracking
- rapid food-forest growth and transformation across sites

## 10. Data Collection Plan to Complete v1

### 10.1 Farm Survey (Human-Led, High Priority)

Collect first:

- zone map sketch (paper is fine)
- water system topology (source -> storage -> pump -> lines -> valves -> zones)
- current power availability/reliability at control points
- list of existing manual irrigation routines
- crop inventory by zone and layer
- critical seasonal windows (flowering, fruiting, harvest, pruning)
- recurring problems (water scarcity, pests, bee decline, disease, labor bottlenecks)

### 10.2 Device/Network Survey (Human + Jetson)

Collect:

- where Jetson can be placed safely
- Wi-Fi coverage dead zones
- cellular availability
- power backup availability
- distances to pump/valves/tanks
- enclosure/environment constraints (heat, dust, rain, rodents)

### 10.3 Knowledge Ingestion (Mac Agent)

Ingest and index:

- existing Bhoomi YouTube summaries
- future transcript summaries
- field notes and photos
- seasonal logs
- trial results

Also maintain comparative knowledge from non-Shamli Bhoomi projects (Mumbai, Konkan, Noida, etc.) to support:

- adaptation patterns by terrain/climate
- species and companion experiments
- timeline expectations for transformations
- transferability limits (what worked elsewhere may not fit Shamli without validation)

## 11. Implementation Phases (Suggested)

### Phase A: Farm Twin Foundation (no automation dependency)

- create the Bhoomi site/zone/asset/crop inventory
- define operation library and task templates
- define evidence and event schema
- ingest current repo knowledge as seed data

### Phase B: Mesh Visibility

- ClawMesh `start`, live `peers`, live `status`
- register Mac/Jetson nodes with capabilities
- basic farm telemetry message formats
- event log and audit trail

### Phase C: Human-Assisted Execution

- dispatch inspection tasks to human mobile
- record verification evidence
- add low-risk sensor reads and notifications

### Phase D: Controlled Automation

- irrigation/pump/valve control with strict safety limits
- runtime verification (flow/tank/valve state)
- offline-safe Jetson behavior

### Phase E: Research + Optimization

- crop suitability recommendations by zone
- trial planning and tracking
- seasonal performance feedback loops

## 12. Open Questions (to resolve from field reality)

These are the highest-value unknowns for the next iteration:

- exact zone map and area split across the 10 acres
- current water sources and seasonal reliability
- existing pump/valve layout and manual operating practice
- current power system and backup availability
- current network coverage on farm (Wi-Fi/cellular)
- which tasks are safe to automate first vs must stay human-only
- what evidence is acceptable to declare a task complete
- which crops/operations are most economically important (priority ranking)
- what the bee decline issue looked like operationally and what signals were observed

## 13. Suggested File Layout (Future, inside ClawMesh)

When implementation starts, store the Farm Twin in versioned files:

- `farm/bhoomi/site.yaml`
- `farm/bhoomi/zones/*.yaml`
- `farm/bhoomi/assets/*.yaml`
- `farm/bhoomi/crops/*.yaml`
- `farm/bhoomi/operations/*.yaml`
- `farm/bhoomi/tasks/*.jsonl`
- `farm/bhoomi/events/*.jsonl`
- `farm/bhoomi/evidence/` (metadata refs, not large binaries)

This keeps the system inspectable, diffable, and compatible with agent workflows.
