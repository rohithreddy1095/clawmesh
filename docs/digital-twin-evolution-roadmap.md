# Digital Twin Evolution Roadmap

Status: Living document  
Updated: 2026-03-07

## The Deep Vision

The `/twin3d` page is not a one-off 3D demo. It's the **spatial interface** of the entire ClawMesh system, and it evolves through four stages — from what we know today (website + YouTube videos) to a fully operational farm control surface.

```
Stage 1: INFERRED         Stage 2: SURVEYED         Stage 3: INSTRUMENTED      Stage 4: OPERATIONAL
┌──────────────┐         ┌──────────────┐          ┌──────────────┐           ┌──────────────┐
│ BhoomiNatural│         │ Field survey │          │ Real sensors │           │ Autonomous   │
│ website data │         │ GPS walks    │          │ deployed on  │           │ irrigation   │
│ + YouTube    │───────▶ │ Tape measure │────────▶ │ farm, mesh   │─────────▶ │ loops with   │
│ videos       │         │ Photos       │          │ connected    │           │ human-in-    │
│ + Mr Green   │         │ Drone aerial │          │ Drip lines   │           │ the-loop     │
│   reports    │         │              │          │ installed    │           │              │
└──────────────┘         └──────────────┘          └──────────────┘           └──────────────┘
  We are HERE              Next trip                 Hardware phase             Full ClawMesh
```

## Stage 1: Inferred Twin (Current)

**What we have:**
- 46 YouTube videos (34 from Shamli farm) with metadata, titles, descriptions
- BhoomiNatural website with crop catalog, process steps, food forest layers
- 7 Mr Green Architect reports with vision boards, diagnostics, masterplans
- Structured data: `extracted_data.json` (21 analyzed videos), `locations.json`, `categories.json`
- `farm/bhoomi/` YAML: site profile, 8 candidate zones, water system draft, crop catalog, operations library

**What the 3D twin shows:**
- Placeholder zone layout (~200m × 200m grid)
- Approximate infrastructure positions (pump, tank, valves)
- Estimated crop cluster locations (from YouTube content analysis)
- Water network topology (mainline → sublines → drip — guessed layout)
- Layer visualization (canopy 8-15m, subcanopy 4-8m, shrub 1-3m, ground 0-1m)

**Quality:** All positions are inference. `needs_field_validation: true` on everything.

## Stage 1.5: Video Intelligence (Next Build)

**Goal:** Use Gemini multimodal models to extract spatial and operational knowledge from YouTube videos.

### Gemini Video Analysis Pipeline

```
YouTube video URL
    │
    ▼
┌─────────────────────┐
│ Download video/audio │  (yt-dlp or YouTube Data API)
│ Extract key frames  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│ Gemini 2.5 Flash / Pro                  │
│                                          │
│ Prompt: "You are analyzing a food forest │
│ farm tour video. For each segment..."    │
│                                          │
│ Extract:                                 │
│ - Zone transitions (when walker moves    │
│   from mango area to flower strip)       │
│ - Crop identification + health state     │
│ - Infrastructure visible (pipes, pumps,  │
│   tanks, irrigation channels)            │
│ - Spatial relationships ("papaya behind  │
│   the mango block", "tank near gate")    │
│ - Soil/mulch observations               │
│ - Water features (channels, drip lines)  │
│ - Seasonal state (flowering, fruiting)   │
│ - Relative distances and sizes           │
│ - Existing manual practices              │
│ - Problems visible (dry zones, pests)    │
└──────────┬──────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│ Structured Output (JSON)                 │
│                                          │
│ {                                        │
│   video_id, timestamp_range,             │
│   zone_label, crops_visible: [...],      │
│   infrastructure: [...],                 │
│   spatial_hints: [                       │
│     "tank is 20m west of main gate",     │
│     "gladiolus strip runs N-S along      │
│      eastern boundary"                   │
│   ],                                     │
│   observations: [...],                   │
│   confidence: 0.0-1.0                    │
│ }                                        │
└──────────┬──────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│ Farm Twin Updater                        │
│                                          │
│ - Refine zone boundaries                 │
│ - Add discovered infrastructure          │
│ - Update crop cluster positions          │
│ - Flag contradictions across videos      │
│ - Generate survey validation tasks       │
│ - Tag everything as T0 (inference)       │
└─────────────────────────────────────────┘
```

### Key Videos to Analyze (Priority Order)

| Priority | Video ID | Title | Why |
|----------|----------|-------|-----|
| 1 | MJ0uoV7lURs | 10 ACRE Multilayer Sustainable Food Forest Tour | 160K views, most comprehensive farm walkthrough |
| 2 | SlDb256ENuM | 10 Acre FOOD FOREST Tour (with Beekeeping) | 46K views, includes beekeeping area |
| 3 | NzCpAtIg090 | Farm Tour - 35+ Fruits, Turmeric | Most crop diversity visible |
| 4 | I5w7DuGiA5M | Convert Mango Orchard into Food Forest | Shows layout transformation |
| 5 | 55O8SRNYYP4 | Gold Harvesting: Turmeric | Shows ground layer + intercropping |
| 6 | u1TxZ25o1zo | LOW COST Irrigation + Jeevamrit | Shows water/irrigation system |
| 7 | Ym00HMUECU0 | Gladiolus Harvest to Packaging | Shows flower zone + harvest area |
| 8 | 6ncpHq-ppbo | No Tilling Food Forest Farm Tour | Shows no-till methodology |

### What Video Analysis Gives the 3D Twin

From a single comprehensive farm tour video, Gemini can likely infer:
- **Relative zone layout** (which blocks are adjacent, approximate sizes)
- **Walking path** (reconstructing a rough map from the video route)
- **Tree density** (more accurate tree counts per cluster)
- **Infrastructure placement** (where the pump house actually is relative to the orchard)
- **Irrigation evidence** (visible drip lines, channels, hose positions)
- **Crop identification** (species confirmation from visual + audio)
- **Seasonal state** (what's flowering/fruiting at the time of recording)

This upgrades the placeholder positions to **inferred positions** — still T0 evidence, but much closer to reality.

## Stage 2: Surveyed Twin

**What field survey adds:**
- GPS-measured zone boundaries (phone GPS ≈ 3-5m accuracy)
- Tape-measured tank dimensions, pipe diameters
- Photographed pump specs, valve positions
- Counted tree positions (at least major trees)
- Documented irrigation sequence (which valve opens for which zone, how long)
- WiFi/cellular coverage map
- Power point locations

**What changes in the 3D twin:**
- Zone polygons snap to real GPS coordinates
- `geo_anchor` enables satellite photo underlay
- Infrastructure positions become measured (T2 trust)
- Water network topology becomes verified
- Can generate accurate drip line orders and sensor placement plans

## Stage 3: Instrumented Twin

**What real sensors add:**
- Live soil moisture per zone (every 10-30 min)
- Tank level (continuous)
- Flow rate (when pump runs)
- Weather data (temp, humidity, rain)
- Pump on/off state

**What changes in the 3D twin:**
- Zones show real-time moisture heatmap
- Tank shows actual water level
- Pipes animate when flow is detected
- Alerts pulse on the 3D map (zone dry, tank low)
- Historical playback (scrub timeline, see how farm dried over the week)

## Stage 4: Operational Twin

**What automation adds:**
- Operator clicks a zone in 3D → "Irrigate this zone for 20 min"
- System traces the water path (pump → mainline → subline → valve → drip)
- Proposal appears for approval (shown in 3D with highlighted path)
- On approval, pump starts, valve opens, flow confirmed
- 3D shows live flow animation along the active path
- On completion, zone moisture updates, task marked complete

## Connecting to Mr Green Architect

The Mr Green "Design Your Farm" tool on bhoominatural.com generates:
- Strategic vision boards (7 per report)
- Masterplan visualizations (AI-generated images)
- Site diagnostics (rainfall, soil, sun analysis)
- Critical design questions

These feed into the digital twin as **T0 planning inputs**:
- Vision boards → candidate zone ideas, infrastructure concepts
- Masterplans → rough spatial layout hypotheses
- Diagnostics → climate/soil parameters for irrigation planning
- Questions → survey tasks

The pipeline is: **Mr Green designs → ClawMesh validates → 3D twin renders → mesh executes**

## Technical Notes

### Gemini API for Video Analysis
- Model: `gemini-2.5-flash` or `gemini-2.5-pro` (multimodal)
- Input: Upload video file via File API, or pass key frames as images
- Context window: Large enough for video analysis (up to 1M tokens)
- Cost: Flash is ~$0.10/M input tokens, Pro is ~$1.25/M — analyze all 34 Shamli videos for <$5
- API key: Already stored in credential store (`provider/google`)

### Video Processing Options
1. **Direct Gemini Video API** — Upload video file, let Gemini process all frames
2. **Key frame extraction** — ffmpeg extract frames every N seconds, send as images
3. **Audio transcript + frames** — Extract Hindi/English transcript + key frames for richer analysis

### Data Quality Chain
```
Mr Green report (T0)  ─┐
YouTube analysis (T0)  ─┤──▶ Inferred Twin (placeholder positions)
Website data (T0)      ─┘
                            │
Field survey (T2)      ────▶ Surveyed Twin (measured positions)
                            │
Sensor readings (T2)   ────▶ Instrumented Twin (live data overlay)
                            │
Execution evidence (T3) ───▶ Operational Twin (verified actions)
```

Each upgrade step makes the twin more trustworthy and more useful.
