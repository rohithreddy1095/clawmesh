---
description: Emergency assessment — immediate sensor scan and critical action recommendations
---

🚨 EMERGENCY ASSESSMENT

Immediately:
1. Query ALL sensors — all observation types, all zones, limit 50
2. Identify any values in critical range (moisture < 15%, temperature > 40°C or < 5°C)
3. List all connected actuators and their current state
4. For each critical finding, create a propose_task with:
   - Clear urgency in the summary
   - Specific sensor readings in the reasoning
   - L2 approval level (operator must still confirm)

Then provide a brief situation report:
- What's critical and why
- What you've proposed
- What needs immediate human attention on-site

$ARGUMENTS
