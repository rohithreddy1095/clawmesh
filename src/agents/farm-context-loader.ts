import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { FarmContext, ApprovalLevel } from "./types.js";

/**
 * Load Bhoomi farm context from the YAML data files.
 * 
 * Uses simple line-based YAML parsing (no external YAML lib needed) to extract
 * the structured farm data that gets injected into the planner's system prompt.
 */
export function loadBhoomiContext(farmRoot?: string): FarmContext {
  const root = farmRoot ?? resolve(process.cwd(), "farm/bhoomi");

  return {
    siteName: "Bhoomi Natural (Shamli, UP, ~10 acres)",

    zones: loadZones(root),
    assets: loadAssets(root),
    operations: loadOperations(root),
    safetyRules: [
      "No pump run without valid water source/tank condition",
      "No irrigation beyond zone max runtime/max volume without renewed approval",
      "No actuator action when communication state is unknown",
      "Default fail-safe state for valves/pumps on controller restart",
      "Manual override always takes priority over automated commands",
      "No physical actuation triggered solely by LLM inference — requires sensor + human evidence",
      "Dosage and dilution policy must be defined before Jeevamrit automation",
      "Bounded runtime/volume constraints on all irrigation operations",
    ],
  };
}

function loadZones(root: string): FarmContext["zones"] {
  // Parse candidate zones
  const zonesFile = resolve(root, "zones/candidate-zones.yaml");
  const siteFile = resolve(root, "zones/site-root.yaml");

  const zones: FarmContext["zones"] = [
    { zoneId: "z-site-root", name: "Bhoomi Main Farm (Shamli)", area: "~10 acres" },
  ];

  if (existsSync(zonesFile)) {
    try {
      const content = readFileSync(zonesFile, "utf-8");
      // Extract zone entries from the YAML
      const zoneMatches = content.matchAll(/zone_id:\s*"?([^"\n]+)"?\s*\n\s*name:\s*"?([^"\n]+)"?/g);
      for (const match of zoneMatches) {
        zones.push({
          zoneId: match[1].trim(),
          name: match[2].trim(),
        });
      }
    } catch {
      // ignore parse errors
    }
  }

  // Enrich with crop data
  const cropsFile = resolve(root, "crops/catalog-observed.yaml");
  if (existsSync(cropsFile)) {
    try {
      const content = readFileSync(cropsFile, "utf-8");

      // Extract priority crops
      const cropMatches = content.matchAll(/- crop:\s*"?([^"\n]+)"?/g);
      const priorityCrops: string[] = [];
      for (const match of cropMatches) {
        priorityCrops.push(match[1].trim());
      }

      // Attach to the root zone for now
      if (priorityCrops.length > 0 && zones.length > 0) {
        zones[0].crops = priorityCrops;
      }
    } catch {
      // ignore
    }
  }

  return zones;
}

function loadAssets(root: string): FarmContext["assets"] {
  const assets: FarmContext["assets"] = [];

  const controlFile = resolve(root, "assets/control-and-network-draft.yaml");
  if (existsSync(controlFile)) {
    try {
      const content = readFileSync(controlFile, "utf-8");

      // Extract planned field nodes
      const nodeMatches = content.matchAll(/node_id:\s*"?([^"\n]+)"?\s*\n\s*role:\s*"?([^"\n]+)"?/g);
      for (const match of nodeMatches) {
        assets.push({
          assetId: match[1].trim(),
          type: match[2].trim().replace(/_/g, " "),
        });
      }
    } catch {
      // ignore
    }
  }

  const waterFile = resolve(root, "assets/water-system-draft.yaml");
  if (existsSync(waterFile)) {
    try {
      const content = readFileSync(waterFile, "utf-8");

      // Extract water assets
      const assetMatches = content.matchAll(/asset_id:\s*"?([^"\n]+)"?\s*\n\s*asset_type:\s*"?([^"\n]+)"?/g);
      for (const match of assetMatches) {
        assets.push({
          assetId: match[1].trim(),
          type: match[2].trim(),
        });
      }
    } catch {
      // ignore
    }
  }

  // Add well-known mesh nodes
  if (!assets.some((a) => a.assetId === "mac-main")) {
    assets.push({
      assetId: "mac-main",
      type: "planner operator console",
      capabilities: ["planner:seasonal", "planner:irrigation", "knowledge:crop-suitability"],
    });
  }
  if (!assets.some((a) => a.assetId === "jetson-field-01")) {
    assets.push({
      assetId: "jetson-field-01",
      type: "field brain",
      capabilities: ["sensor:soil-moisture:*", "actuator:pump:*", "actuator:valve:*", "vision:plant-health:*"],
    });
  }

  return assets;
}

function loadOperations(root: string): FarmContext["operations"] {
  const ops: FarmContext["operations"] = [];

  const opsFile = resolve(root, "operations/library.yaml");
  if (existsSync(opsFile)) {
    try {
      const content = readFileSync(opsFile, "utf-8");

      // Parse operation blocks
      const opBlocks = content.split(/\n  - operation_id:/);
      for (const block of opBlocks.slice(1)) {
        const nameMatch = block.match(/name:\s*"?([^"\n]+)"?/);
        const purposeMatch = block.match(/purpose:\s*"?([^"\n]+)"?/);
        const rolesRaw = block.match(/required_roles:\s*\n((?:\s+- .+\n?)+)/);

        const name = nameMatch?.[1]?.trim() ?? "Unknown";
        const description = purposeMatch?.[1]?.trim() ?? "";

        // Derive approval level from roles
        let level: ApprovalLevel = "L2";
        if (rolesRaw) {
          const roles = rolesRaw[1];
          if (roles.includes("jetson") || roles.includes("field_node")) {
            level = "L1"; // automated with safety bounds
          }
          if (roles.includes("human") && !roles.includes("hybrid") && !roles.includes("jetson")) {
            level = "L3"; // human-only
          }
        }

        ops.push({ name, description, approvalLevel: level });
      }
    } catch {
      // ignore
    }
  }

  // Always include the core irrigation operation
  if (!ops.some((o) => o.name.toLowerCase().includes("irrigation"))) {
    ops.push({
      name: "Irrigation",
      description: "Deliver water to zones with bounded runtime/volume safety limits",
      approvalLevel: "L2",
    });
  }

  return ops;
}
