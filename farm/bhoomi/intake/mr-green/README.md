# Mr Green Report Intake

This directory stores normalized imports of `Mr Green Architect` report exports (HTML and optional JSON).

Goal:

- extract stable, reusable "core blocks" from design reports
- preserve provenance (source files, generator text, report date/location)
- separate reusable planning knowledge from the live farm state

Typical flow:

1. Export report HTML from the Bhoomi "Design Your Farm with AI" flow.
2. Optionally keep the `mrgreen-project-*.json` state export if available.
3. Run:

```bash
node scripts/farm/import-mrgreen-reports.mjs
```

Outputs:

- `reports/*.yaml` — normalized per-report block files
- `index.yaml` — summary index of imported reports

Notes:

- Imported content is design/planning input, not field-verified farm truth.
- Treat diagnostics and recommendations as `inference_repo` until validated on-site.
- Do not use imported Mr Green / LLM report content as a direct trigger for physical actuation.
