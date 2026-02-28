# Bhoomi Farm Twin Seed Data

This directory contains the first machine-readable seed files for the Bhoomi Natural farm twin.

Principles:

- prefer explicit facts with source references
- mark inferred values as `needs_field_validation: true`
- keep runtime logs (`tasks/*.jsonl`, `events/*.jsonl`) append-only
- keep large media outside git; store evidence metadata references here

Key files:

- `site.yaml` - site profile and farm-level metadata
- `sources.yaml` - repository-derived evidence sources used to seed data
- `zones/` - zone inventory (starts with root + candidate zones)
- `assets/` - water/control/network asset drafts
- `crops/` - observed crops and output catalog
- `operations/` - operation library seed definitions
- `surveys/` - field checklists to convert unknowns into validated data

Status:

- v0 seed, mostly repo-derived
- not yet field-validated
