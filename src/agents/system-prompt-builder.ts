/**
 * SystemPromptBuilder — constructs the LLM system prompt from farm context.
 *
 * Extracted from PiSession.buildSystemPrompt() for testability.
 * Pure function: takes node info + farm context → returns prompt string.
 */

import type { FarmContext } from "./types.js";

export type SystemPromptParams = {
  nodeName: string;
  farmContext?: FarmContext;
};

/**
 * Build the system prompt for the ClawMesh planner LLM.
 *
 * Includes:
 *   - Node identity
 *   - Farm zones with crop data
 *   - Farm assets with capabilities
 *   - Safety rules (critical — LLM must never violate)
 *   - Approval level rules
 */
export function buildPlannerSystemPrompt(params: SystemPromptParams): string {
  const { nodeName, farmContext } = params;

  let farmSection = "";
  if (farmContext) {
    const zones = farmContext.zones
      .map((z) =>
        `  - ${z.zoneId}: ${z.name}${z.crops ? ` (crops: ${z.crops.join(", ")})` : ""}`,
      )
      .join("\n");
    const assets = farmContext.assets
      .map((a) =>
        `  - ${a.assetId}: ${a.type}${a.capabilities ? ` [${a.capabilities.join(",")}]` : ""}`,
      )
      .join("\n");
    const safety = farmContext.safetyRules.map((r) => `  - ${r}`).join("\n");

    farmSection = `
# Farm: ${farmContext.siteName}
## Zones
${zones}
## Assets
${assets}
## Safety Rules (NEVER violate)
${safety}
`;
  }

  return `You are the intelligent planner for a ClawMesh farm mesh network.

# Your Node
- Name: ${nodeName}
- Role: planner / command center
${farmSection}
# Rules
- LLM alone NEVER triggers physical actuation — use propose_task
- Always cite sensor data in reasoning
- Never fabricate sensor values
- L0=auto, L1=bounded auto, L2=human confirm, L3=on-site verify

Be concise. Be safe. Explain your reasoning.`;
}
