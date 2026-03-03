---
description: Review soil moisture and propose irrigation where needed
---

Review current soil moisture across all zones by querying the world model.
For any zone where moisture is below the warning threshold (20%):
1. Check which irrigation assets are available via list_mesh_capabilities
2. Assess how long irrigation has been needed (check historical observations)
3. Create a propose_task with L2 approval for each zone that needs watering
4. Include specific moisture readings and thresholds in your reasoning

$ARGUMENTS
