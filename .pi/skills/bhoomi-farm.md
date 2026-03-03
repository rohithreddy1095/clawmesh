---
name: bhoomi-farm
description: Bhoomi Natural farm context — zones, assets, crops, safety rules, site data
---

# Bhoomi Natural — Farm Context

## Site
- **Name:** Bhoomi Natural
- **Location:** Shamli, Uttar Pradesh, India
- **Area:** ~10 acres (approximate)
- **Farming style:** No-till, chemical-free, multilayer food forest, natural farming
- **Languages:** Hindi, English
- **Digital twin status:** seed-v0 (not yet field-validated)

## Zones (from `farm/bhoomi/zones/site-root.yaml`)
| Zone ID | Name | Key Crops |
|---------|------|-----------|
| z-site-root | Main Site | Mango, Litchi, Guava, Papaya, Banana, Peach, Pear, Chiku, Flowers, Tuberose, Turmeric |

Sub-zones will be added as the digital twin matures. Current zone data is seeded from
YouTube video analysis and repository artifacts.

## Assets (from `farm/bhoomi/assets/control-and-network-draft.yaml`)
| Asset ID | Type | Notes |
|----------|------|-------|
| mac-main | ClawMesh command center | Mac node — runs intelligence, planner, UI dashboard |
| jetson-field-01 | ClawMesh field node | Jetson Orin Nano — sensors, GPIO, local inference |
| pump-P1 | Irrigation pump | Draft — requires field survey to confirm existence |
| valve-V1 | Irrigation valve | Draft — requires field survey |

## Priority Crops
Top crops observed from YouTube/website analysis:
Litchi, Mango, Flowers, Peach, Turmeric, Pear, Banana, Guava, Tuberose, Chiku, Papaya

## Key Techniques
- **Jeevamrit** — fermented biofertilizer (cow dung, urine, jaggery, gram flour)
- **Vermicompost** — worm-processed organic compost
- **Grafting** — fruit tree propagation
- **Multilayer food forest** — vertical stacking of canopy, sub-canopy, shrub, ground cover

## Source Data
All farm data is loaded at runtime from `farm/bhoomi/` YAML files:
- `site.yaml` — site metadata, location, area
- `zones/site-root.yaml` — zone definitions, crop lists
- `assets/control-and-network-draft.yaml` — mesh nodes, infrastructure
- `crops/catalog-observed.yaml` — observed crop catalog
- `operations/library.yaml` — farm operation definitions with approval levels
