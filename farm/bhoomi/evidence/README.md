# Evidence Directory Conventions

Store metadata references here, not large raw media files.

Recommended approach:

- keep photos/videos in external storage (phone album, cloud drive, NAS)
- store JSON/YAML metadata records here with:
  - timestamp
  - source device
  - linked `zone_id` / `asset_id` / `task_id`
  - short summary
  - URI/path to raw media
  - confidence / verification status

Example filenames:

- `2026-02-26-zone-map-photo.yaml`
- `2026-02-26-pump-main-01-nameplate.yaml`
- `2026-02-26-bee-activity-observation-am.yaml`
