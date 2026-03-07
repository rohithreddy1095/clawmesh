# Digital Twin 3D Architecture — v0

Status: Proposal  
Date: 2026-03-07  
Author: ClawMesh (Jetson session)

## 1. What We're Building

A **spatial farm design and operations tool** that lives inside the ClawMesh Web UI. Not a dashboarding layer on top of sensor data — a real planning surface where you can:

1. **Design before buying** — Place sensors, actuators, drip lines, valves, motors on a spatial map of the farm before purchasing or installing anything
2. **See the farm as it is** — Zones, infrastructure, crop layers, water topology rendered in a navigable 3D view
3. **See the farm as it runs** — Live sensor data, motor states, moisture heatmaps, alerts overlaid on the same geometry once hardware is deployed
4. **Plan irrigation** — Trace water flow from source → tank → pump → mainline → subline → valve → zone, and understand which zones get fed when which valve opens

## 2. Why 3D (Not Just a 2D Map)

The food forest is **multilayer by nature**. A 2D zone map can't show:

- Canopy (8–15m) shading the shrub layer (1–3m) below
- Drip lines at ground level vs overhead misters for nursery
- Tank elevation relative to gravity-fed zones
- Sensor post height vs tree canopy obstruction for weather stations
- Pump house interior layout (pump + filter + manifold + valves)

The 3D doesn't need to be photorealistic. It needs to be **spatially honest** — correct relative positions, heights, and connectivity.

## 3. Technology Choice: Three.js + React Three Fiber

### Why Three.js

| Option | Verdict |
|--------|---------|
| **Three.js / R3F** | ✅ Best fit — runs in browser, huge ecosystem, supports GeoJSON import, instanced rendering for trees, line geometry for pipes, custom shaders for heatmaps |
| Mapbox GL / Deck.gl | Good for geo-overlay but overkill for a 10-acre farm; forces lat/lon coordinates prematurely |
| Babylon.js | Heavier than Three.js; no significant advantage for this use case |
| 2D Canvas / SVG | Can't represent the multilayer structure; dead end |
| Unity/Unreal (WebGL export) | Way too heavy; not embeddable in a Next.js app |

### Stack

```
Next.js (existing ui/)
  └── React Three Fiber (@react-three/fiber)
       └── Three.js
       └── @react-three/drei (helpers: OrbitControls, Html labels, Line, etc.)
       └── leva (optional: for debug knobs during design)
```

This integrates directly into the existing `ui/` Next.js app alongside the current Mesh Topology, Twin, Telemetry, and Command pages.

## 4. Spatial Data Model

The 3D scene is **data-driven**. The renderer reads structured YAML/JSON — the same farm twin data already in `farm/bhoomi/`. No hardcoded scene geometry.

### 4.1 Coordinate System

**Farm-local meters** with an arbitrary origin (e.g., main gate or pump house corner).

```
X = East  (meters from origin)
Y = Up    (meters above ground)
Z = South (meters from origin)
```

Before the field survey produces GPS coordinates, everything is relative. After survey, we can store a `geo_anchor` (lat/lon of origin + rotation to true north) and convert when needed for satellite overlay.

```yaml
# farm/bhoomi/site.yaml (additions)
spatial:
  coordinate_system: "farm_local_meters"
  origin_label: "Pump house NE corner"
  geo_anchor:          # null until surveyed
    lat: null
    lon: null
    bearing_deg: null   # rotation from farm-X to true east
  bounds:
    x_min: 0
    x_max: 200          # ~10 acres ≈ 200m × 200m square (approx)
    z_min: 0
    z_max: 200
```

### 4.2 Zone Geometry

Each zone gets a 2D polygon (ground footprint) + height range for the 3D extrusion.

```yaml
# farm/bhoomi/zones/z-food-forest-core.yaml (spatial addition)
spatial:
  polygon:             # vertices in farm-local meters [x, z]
    - [20, 30]
    - [120, 30]
    - [120, 150]
    - [20, 150]
  elevation_base: 0    # ground level (meters)
  layer_heights:       # for rendering the food forest layers
    canopy_top: 12
    subcanopy_top: 6
    shrub_top: 2.5
    ground_top: 0.5
```

### 4.3 Infrastructure Placement

Assets get a 3D position + optional connection references.

```yaml
# farm/bhoomi/assets/pump-main-01.yaml (spatial addition)
spatial:
  position: [5, 0, 10]        # [x, y, z] in farm-local meters
  rotation_y_deg: 0
  model_hint: "pump_submersible"   # for 3D model selection

# farm/bhoomi/assets/tank-01.yaml
spatial:
  position: [8, 0, 12]
  dimensions:
    diameter_m: 3
    height_m: 2
  model_hint: "tank_overhead_round"
```

### 4.4 Water Network Topology (Pipe/Line Geometry)

Water lines are modeled as **connected segments** with a source, destination, and intermediate waypoints.

```yaml
# farm/bhoomi/assets/water-lines.yaml
lines:
  - line_id: "mainline-01"
    from_asset: "pump-main-01"
    to_asset: "manifold-01"
    waypoints:          # [x, y, z] intermediate points
      - [5, -0.3, 10]
      - [5, -0.3, 50]
      - [30, -0.3, 50]
    pipe_diameter_mm: 63
    pipe_material: "HDPE"
    buried: true
    color_hint: "blue"

  - line_id: "subline-z-food-forest-core"
    from_asset: "manifold-01"
    to_asset: "valve-zone-core-01"
    waypoints:
      - [30, -0.3, 50]
      - [30, -0.3, 80]
    pipe_diameter_mm: 32
    pipe_material: "HDPE"
    buried: true

  - line_id: "drip-zone-core-row-01"
    from_asset: "valve-zone-core-01"
    to_zone: "z-food-forest-core"
    waypoints:
      - [30, 0, 80]
      - [120, 0, 80]
    pipe_diameter_mm: 16
    pipe_material: "LLDPE_drip"
    buried: false
    color_hint: "brown"
    drip_spacing_cm: 30
    drip_flow_lph: 2
```

### 4.5 Sensor/Actuator Placement

```yaml
# farm/bhoomi/assets/sensors/
- sensor_id: "soil-moisture-z-core-01"
  type: "soil_moisture"
  position: [70, -0.15, 90]   # buried 15cm
  zone_id: "z-food-forest-core"
  mesh_capability: "sensor:soil-moisture:z-food-forest-core"
  model_hint: "probe_soil"

- sensor_id: "weather-station-01"
  type: "weather_station"
  position: [10, 3, 5]         # on a 3m pole near pump house
  zone_id: "z-water-infra"
  mesh_capability: "sensor:air-temp:site"
  model_hint: "pole_weather"
```

## 5. Scene Architecture (What Gets Rendered)

### 5.1 Layer Stack

```
Scene
├── Ground Plane (textured grid, farm boundary outline)
├── Zone Volumes (semi-transparent extruded polygons per zone)
│   ├── z-food-forest-core (green tinted, layered bands for canopy/shrub/ground)
│   ├── z-flower-production (warm-tinted band)
│   ├── z-water-infra (blue-tinted band)
│   └── ...
├── Infrastructure Objects (instanced low-poly meshes)
│   ├── Tanks (cylinders/boxes)
│   ├── Pumps (box + pipe stubs)
│   ├── Valves (small cylinders on pipe junctions)
│   ├── Sensors (colored pins/probes)
│   └── Actuators (solenoid icons)
├── Water Network (Three.js Line/Tube geometry)
│   ├── Mainlines (thick blue tubes)
│   ├── Sublines (medium tubes)
│   ├── Drip lines (thin brown lines)
│   └── Flow arrows (animated when pump is running)
├── Crop Layer Indicators (instanced billboards or simple tree shapes)
│   ├── Canopy trees (tall cones/spheres at 8-12m)
│   ├── Sub-canopy trees (medium shapes at 4-6m)
│   ├── Shrub layer (low shapes)
│   └── Ground cover (textured ground patches)
├── Live Data Overlays
│   ├── Moisture heatmap (vertex-colored ground mesh per zone)
│   ├── Temperature badges (Html labels floating above sensors)
│   ├── Flow indicators (animated particles along active pipes)
│   ├── Alert markers (pulsing red/orange icons)
│   └── Motor state indicators (spinning/stopped icons on pumps)
└── UI Overlays
    ├── Selection highlight (glow outline on clicked object)
    ├── Info panel (side drawer with asset details)
    ├── Placement ghost (translucent object following cursor in design mode)
    └── Measurement tool (line + distance label between two clicks)
```

### 5.2 View Modes

| Mode | Purpose | What's Visible |
|------|---------|----------------|
| **Design** | Planning before hardware deployment | Zones, infrastructure placement, pipe routing, measurement tool, crop layer indicators. No live data. |
| **Operations** | Daily monitoring after deployment | Same geometry + live sensor data, moisture heatmap, flow animation, alerts, motor states. |
| **Water** | Focused water system view | Water network highlighted, everything else dimmed. Flow direction arrows. Click a valve to see which zones it feeds. |
| **Layer** | Food forest layer inspection | Zones with adjustable height slider — slide to "canopy only", "shrub only", etc. Crop inventory overlaid. |

### 5.3 Interaction

- **Orbit** — Click-drag to rotate, scroll to zoom, right-drag to pan (standard Three.js OrbitControls)
- **Click object** — Opens info panel with asset details, sensor readings, links to operations
- **Hover** — Tooltip with name + last reading
- **Design mode: drag-drop** — Select from a palette (sensor, valve, pump, drip line) and place on the ground plane
- **Design mode: draw pipe** — Click waypoints to draw a pipe route between two assets
- **Design mode: define zone** — Click polygon vertices on ground plane to create a new zone boundary

## 6. Data Flow: YAML → Scene → Live Updates

```
                    ┌──────────────────────┐
                    │  farm/bhoomi/*.yaml   │  (static geometry)
                    └──────────┬───────────┘
                               │  loaded at page init
                               ▼
                    ┌──────────────────────┐
                    │  FarmSceneLoader     │  parses YAML → SceneGraph objects
                    │  (TypeScript)         │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  React Three Fiber   │  renders SceneGraph as Three.js objects
                    │  <Canvas>            │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                 ▼
    [Zone meshes]    [Pipe geometry]    [Asset instances]
              
              
                    ┌──────────────────────┐
                    │  WebSocket (existing) │  context.frame events
                    │  useMesh() hook       │
                    └──────────┬───────────┘
                               │  real-time
                               ▼
                    ┌──────────────────────┐
                    │  useFarmTwin() hook   │  maps sensor frames → zone/asset state
                    │  (new Zustand slice)  │
                    └──────────┬───────────┘
                               │
                               ▼
                    [Heatmap colors, flow animations,
                     badge values, alert markers update
                     every frame in the 3D scene]
```

### Design Mode Data Flow

When the user places/moves objects in design mode, the changes are written back to the YAML files via an API:

```
User drags sensor → React state updates → POST /api/farm/asset (or WebSocket RPC)
  → Server writes to farm/bhoomi/assets/sensors/soil-moisture-z-core-01.yaml
  → Git commit (optional, for version tracking)
```

## 7. What the Field Survey Must Produce

The 3D scene is only as good as its spatial data. The field survey (using `farm/bhoomi/surveys/field-survey-checklist-v0.md` as a starting point) must produce:

### Minimum Viable Survey Output

| Data | Method | Output Format |
|------|--------|---------------|
| **Farm boundary** | Walk the perimeter with phone GPS (Google Maps timeline export or GPX track) | Polygon in lat/lon → convert to farm-local meters |
| **Zone boundaries** | Walk each zone boundary, mark corners | Polygon vertices per zone |
| **Pump house location** | GPS point + photos | Position + orientation |
| **Tank(s) location + dimensions** | GPS point + tape measure | Position + diameter/height |
| **Water source location** | GPS point + type identification | Position + type |
| **Existing pipe routes** | Walk the lines, mark visible valve points | Waypoint sequences |
| **Power points** | GPS point + type (grid/solar/battery) | Position + specs |
| **Tree cluster positions** | GPS points for major tree groups (don't need every tree) | Cluster centroids + approx radius + species |
| **WiFi/cellular coverage** | Walk with phone, note signal at each zone | Coverage map |

### Tools Needed

- Smartphone with GPS (you already have this)
- Tape measure (for tank dimensions, pipe diameters)
- Camera (photos of pump, valves, pipe junctions, tank)
- Notepad or voice recorder for notes

### Nice to Have (Later)

- Drone aerial photo (gives exact farm shape + tree positions from overhead)
- RTK GPS (centimeter accuracy — overkill for v0)
- Soil samples per zone (for soil profile)

## 8. Implementation Plan

### Phase 1: Static Scene (no live data)

**Goal:** See the farm in 3D with zones, infrastructure placeholder, and water network draft.

1. Add `@react-three/fiber` and `@react-three/drei` to `ui/package.json`
2. Create `ui/src/app/twin3d/page.tsx` — the 3D twin page
3. Build `FarmSceneLoader` — reads YAML from an API endpoint or bundled JSON
4. Render: ground plane, zone polygons (extruded), placeholder infrastructure boxes, pipe lines
5. OrbitControls + click-to-inspect
6. Toggle between zone layers (canopy/shrub/ground)

**Data needed:** Current `farm/bhoomi/` YAML + spatial additions (can start with approximate/placeholder coordinates before field survey)

### Phase 2: Design Mode

**Goal:** Place sensors, valves, pipe routes on the 3D map.

1. Asset palette sidebar (drag-drop sensor types, valve types, pump, etc.)
2. Ground-plane raycasting for placement
3. Pipe drawing tool (click waypoints)
4. Zone polygon editor
5. Save back to YAML (API endpoint)
6. Undo/redo stack

### Phase 3: Live Data Overlay

**Goal:** Sensor data from ClawMesh world model rendered on the 3D scene.

1. `useFarmTwin()` hook — subscribes to `context.frame` events, maps `sensor:soil-moisture:z-food-forest-core` → zone moisture value
2. Moisture heatmap shader on zone ground meshes
3. Temperature/humidity badges floating above weather stations
4. Tank level indicator (water level inside tank mesh)
5. Pump state animation (spinning/stopped)
6. Flow animation along active pipes (when pump is on + valve is open)
7. Alert pulsing markers

### Phase 4: Water System Focus View

**Goal:** Trace water flow topology interactively.

1. Click a valve → highlight all upstream (source→tank→pump→line→valve) and downstream (valve→sublines→drip→zone) paths
2. Click a zone → highlight the water path that feeds it
3. Show estimated flow rates and runtimes
4. Simulate "what if I open valve X for 30 minutes" — show affected zones

### Phase 5: Satellite Underlay

**Goal:** After field survey provides GPS anchor, overlay the 3D farm on a satellite photo.

1. Fetch satellite tile for the farm coordinates
2. Project as ground-plane texture under the 3D scene
3. Adjust `geo_anchor.bearing_deg` to align farm geometry with satellite image

## 9. File Layout (New Files)

```
ui/src/
├── app/twin3d/
│   └── page.tsx                    # Main 3D twin page
├── components/farm3d/
│   ├── FarmScene.tsx               # Top-level <Canvas> with scene composition
│   ├── GroundPlane.tsx             # Farm boundary + grid
│   ├── ZoneVolume.tsx              # Single zone extruded polygon
│   ├── WaterNetwork.tsx            # All pipes/lines rendered as tubes
│   ├── InfraAsset.tsx              # Generic infrastructure object (tank, pump, valve, sensor)
│   ├── CropLayer.tsx               # Instanced tree/plant indicators
│   ├── MoistureHeatmap.tsx         # Shader-based ground overlay
│   ├── FlowAnimation.tsx           # Animated particles along pipes
│   ├── AlertMarker.tsx             # Pulsing 3D alert indicator
│   ├── DesignPalette.tsx           # Sidebar with draggable asset types
│   ├── PipeDrawTool.tsx            # Interactive pipe routing
│   └── InfoPanel.tsx               # Selected object detail drawer
├── lib/
│   ├── farm-scene-loader.ts        # YAML/JSON → scene graph conversion
│   ├── farm-twin-store.ts          # Zustand slice for live farm state
│   └── farm-spatial-types.ts       # TypeScript types for spatial data
```

## 10. Relationship to Existing Pages

| Page | Role | Relationship to 3D Twin |
|------|------|------------------------|
| `/` (Mesh Topology) | Shows mesh node graph (ReactFlow) | Complementary — topology is logical, twin is spatial |
| `/twin` (Current Digital Twin) | 2D zone cards with moisture/temp | **Replaced** by `/twin3d` in the long run; kept as a simple fallback |
| `/telemetry` | Raw frame log | Data source for the 3D overlays |
| `/command` | Chat with Pi agent | Agent can reference zones/assets visible in the 3D view |
| `/twin3d` (New) | **The spatial design + operations surface** | This is the new primary operator view |

## 11. What We Don't Build Yet

- Photorealistic rendering (stylized/diagrammatic is better for planning)
- VR/AR mode (possible later with WebXR but not v0)
- Autonomous path planning for robots/drones
- Sub-centimeter precision (10cm accuracy is plenty for v0)
- Multi-site support (Shamli only for now)

## 12. Dependencies on Field Survey

The 3D twin can be **built and tested with placeholder data** immediately. The field survey fills in real coordinates. The architecture is designed so that:

- **Before survey:** Approximate zone polygons, estimated positions, topology connections — everything renders but positions are rough
- **After survey:** Replace coordinates with measured values, add satellite underlay — same code, better data
- **Progressive refinement:** Each farm visit can add more detail (new sensor positions, corrected zone boundaries, pipe route adjustments)

## 13. Open Questions

1. Should the 3D view run on Jetson too (lightweight WebGL on a 4GB Nano?) or only on Mac/phone browsers?
2. Should design-mode changes auto-commit to git, or require explicit "save" actions?
3. Do we want a drone photo / satellite image before the first field survey, or is phone GPS sufficient?
4. Should the existing `/twin` page remain as a "simple view" for low-bandwidth situations, or fully replace?
5. How detailed should crop placement be — individual tree positions, or just cluster centroids per zone?
