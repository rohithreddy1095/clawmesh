# Bhoomi Field Survey Checklist v0

Purpose: convert the farm twin seed from repo-derived assumptions to field-validated data.

## 1. Site and Zone Mapping (Highest Priority)

- [ ] Draw a simple map of the full farm (10-acre area) with rough boundaries
- [ ] Mark north direction
- [ ] Split the farm into practical working zones (what the team already calls them)
- [ ] Name each zone (temporary names are fine)
- [ ] Estimate relative size of each zone
- [ ] Mark paths, roads, and access points
- [ ] Mark packing/working areas
- [ ] Mark nursery / grafting / compost / input-prep areas (if separate)
- [ ] Photograph the hand-drawn map

Evidence to capture:

- top-down hand-drawn map photo
- 3-10 representative zone photos
- short voice note or text explaining local zone names

## 2. Water System Topology (Highest Priority)

- [ ] Identify all water sources (borewell / pond / canal / other)
- [ ] Mark all tanks/storage points
- [ ] Record tank counts and approximate capacities
- [ ] Identify all pumps and what they feed
- [ ] Photograph pump nameplates/spec labels
- [ ] Trace main lines and branches
- [ ] Identify manual valves and which zones they control
- [ ] Note current irrigation sequence used by humans
- [ ] Note seasonal water reliability issues

Evidence to capture:

- water path sketch (source -> tank -> pump -> lines -> valves -> zones)
- pump photos + labels
- valve cluster photos
- short note for "how we irrigate today"

## 3. Power and Safety (High Priority)

- [ ] Identify electrical supply points near pump/water controls
- [ ] Note voltage stability issues / outages
- [ ] Note inverter / generator / solar / battery backups (if any)
- [ ] Record what must remain manual for safety
- [ ] Record emergency stop methods and who uses them
- [ ] Identify weather exposure risks (rain, heat, dust)

## 4. Crop and Layer Inventory (High Priority)

- [ ] For each zone, list major crops currently present
- [ ] Mark layer role (canopy / sub-canopy / shrub / ground)
- [ ] Note current stage (vegetative / flowering / fruiting / post-harvest)
- [ ] Note priority crops by economics
- [ ] Note high-care crops (sensitive / high value / labor intensive)
- [ ] Mark trial/experimental areas separately

## 5. Recurring Operations (High Priority)

- [ ] List regular weekly tasks
- [ ] List seasonal tasks (pruning, harvest, planting, etc.)
- [ ] List Jeevamrit / Ghanjeevamrit / compost schedules (if informal, note how decisions are made)
- [ ] List harvest workflows (especially flowers and key fruits)
- [ ] List current pest/disease/pollinator monitoring practices

## 6. Problems and Risks (High Priority)

- [ ] Water scarcity periods
- [ ] Over/under irrigation risks
- [ ] Pump failures / line leaks / blockage issues
- [ ] Power failures
- [ ] Pollinator/bee decline observations
- [ ] Pest/disease hotspots
- [ ] Labor bottlenecks

## 7. Human-in-the-Loop Boundaries (Critical)

- [ ] What actions are safe to automate first?
- [ ] What actions must always require human approval?
- [ ] What actions require on-site human presence?
- [ ] What evidence do you accept as "task completed" (sensor, photo, both)?

## 8. Output Format (Recommended)

After field survey, update:

- `farm/bhoomi/zones/*.yaml`
- `farm/bhoomi/assets/*.yaml`
- `farm/bhoomi/crops/*.yaml`
- `farm/bhoomi/operations/library.yaml`

and attach evidence metadata records in `farm/bhoomi/evidence/`.
