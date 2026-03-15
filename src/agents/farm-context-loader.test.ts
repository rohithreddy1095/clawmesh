import { describe, it, expect } from "vitest";
import { loadBhoomiContext } from "./farm-context-loader.js";
import { resolve } from "node:path";

describe("loadBhoomiContext", () => {
  // Use the actual farm data in the repo
  const farmRoot = resolve(process.cwd(), "farm/bhoomi");

  it("returns a valid FarmContext structure", () => {
    const ctx = loadBhoomiContext(farmRoot);

    expect(ctx.siteName).toBeTruthy();
    expect(ctx.siteName).toContain("Bhoomi");
    expect(Array.isArray(ctx.zones)).toBe(true);
    expect(Array.isArray(ctx.assets)).toBe(true);
    expect(Array.isArray(ctx.operations)).toBe(true);
    expect(Array.isArray(ctx.safetyRules)).toBe(true);
  });

  it("loads at least the root zone", () => {
    const ctx = loadBhoomiContext(farmRoot);
    expect(ctx.zones.length).toBeGreaterThanOrEqual(1);
    expect(ctx.zones[0].zoneId).toBe("z-site-root");
    expect(ctx.zones[0].name).toContain("Bhoomi");
  });

  it("loads candidate zones from YAML", () => {
    const ctx = loadBhoomiContext(farmRoot);
    // Should have more than just the root zone
    expect(ctx.zones.length).toBeGreaterThan(1);
    // Each zone should have zoneId and name
    for (const zone of ctx.zones) {
      expect(zone.zoneId).toBeTruthy();
      expect(zone.name).toBeTruthy();
    }
  });

  it("loads assets including default mesh nodes", () => {
    const ctx = loadBhoomiContext(farmRoot);
    expect(ctx.assets.length).toBeGreaterThanOrEqual(2);

    // Should include default mesh nodes (always added if not already present)
    const macMain = ctx.assets.find((a) => a.assetId === "mac-main");
    expect(macMain).toBeDefined();
    expect(macMain?.type).toContain("planner");

    const jetson = ctx.assets.find((a) => a.assetId === "jetson-field-01");
    expect(jetson).toBeDefined();
    expect(jetson?.type).toContain("field");
  });

  it("loads operations with approval levels", () => {
    const ctx = loadBhoomiContext(farmRoot);
    expect(ctx.operations.length).toBeGreaterThanOrEqual(1);

    // Should always include irrigation
    const irrigation = ctx.operations.find((o) =>
      o.name.toLowerCase().includes("irrigation"),
    );
    expect(irrigation).toBeDefined();
    // Approval level depends on roles in the YAML — L1 for automated, L2 for human-confirm
    expect(["L1", "L2"]).toContain(irrigation?.approvalLevel);
  });

  it("includes critical safety rules", () => {
    const ctx = loadBhoomiContext(farmRoot);
    expect(ctx.safetyRules.length).toBeGreaterThanOrEqual(6);

    // Must include the LLM actuation blocking rule
    const llmRule = ctx.safetyRules.find((r) =>
      r.toLowerCase().includes("llm") && r.toLowerCase().includes("actuation"),
    );
    expect(llmRule).toBeTruthy();

    // Must include pump safety
    const pumpRule = ctx.safetyRules.find((r) =>
      r.toLowerCase().includes("pump"),
    );
    expect(pumpRule).toBeTruthy();
  });

  it("handles non-existent farm root gracefully", () => {
    const ctx = loadBhoomiContext("/tmp/nonexistent-farm-xyz");

    // Should still return valid structure with defaults
    expect(ctx.siteName).toBeTruthy();
    expect(ctx.zones.length).toBeGreaterThanOrEqual(1);
    expect(ctx.assets.length).toBeGreaterThanOrEqual(2); // Default mesh nodes
    expect(ctx.safetyRules.length).toBeGreaterThanOrEqual(1);
  });

  it("zone data has proper types", () => {
    const ctx = loadBhoomiContext(farmRoot);
    for (const zone of ctx.zones) {
      expect(typeof zone.zoneId).toBe("string");
      expect(typeof zone.name).toBe("string");
      if (zone.crops) {
        expect(Array.isArray(zone.crops)).toBe(true);
      }
    }
  });
});
