import { describe, it, expect } from "vitest";
import { buildPlannerSystemPrompt } from "./system-prompt-builder.js";
import type { FarmContext } from "./types.js";

const mockFarmContext: FarmContext = {
  siteName: "Bhoomi Natural (Shamli, UP)",
  zones: [
    { zoneId: "z-root", name: "Main Farm", crops: ["Mango", "Papaya", "Turmeric"] },
    { zoneId: "z-flower", name: "Flower Strip" },
  ],
  assets: [
    { assetId: "mac-main", type: "planner", capabilities: ["planner:seasonal"] },
    { assetId: "jetson-1", type: "field brain", capabilities: ["sensor:moisture", "actuator:pump"] },
  ],
  operations: [
    { name: "Irrigation", description: "Water delivery", approvalLevel: "L2" },
  ],
  safetyRules: [
    "No pump run without valid water source",
    "No actuation from LLM-only evidence",
    "Manual override always takes priority",
  ],
};

describe("buildPlannerSystemPrompt", () => {
  it("includes node name", () => {
    const prompt = buildPlannerSystemPrompt({ nodeName: "mac-main" });
    expect(prompt).toContain("mac-main");
  });

  it("includes planner role", () => {
    const prompt = buildPlannerSystemPrompt({ nodeName: "test" });
    expect(prompt).toContain("planner / command center");
  });

  it("includes LLM actuation blocking rule", () => {
    const prompt = buildPlannerSystemPrompt({ nodeName: "test" });
    expect(prompt).toContain("LLM alone NEVER triggers physical actuation");
  });

  it("includes approval level rules", () => {
    const prompt = buildPlannerSystemPrompt({ nodeName: "test" });
    expect(prompt).toContain("L0=auto");
    expect(prompt).toContain("L2=human confirm");
    expect(prompt).toContain("L3=on-site verify");
  });

  it("includes farm context when provided", () => {
    const prompt = buildPlannerSystemPrompt({
      nodeName: "mac-main",
      farmContext: mockFarmContext,
    });

    expect(prompt).toContain("Bhoomi Natural");
    expect(prompt).toContain("z-root");
    expect(prompt).toContain("Main Farm");
    expect(prompt).toContain("Mango");
  });

  it("includes zones with crop data", () => {
    const prompt = buildPlannerSystemPrompt({
      nodeName: "test",
      farmContext: mockFarmContext,
    });

    expect(prompt).toContain("z-root: Main Farm (crops: Mango, Papaya, Turmeric)");
    expect(prompt).toContain("z-flower: Flower Strip");
  });

  it("includes assets with capabilities", () => {
    const prompt = buildPlannerSystemPrompt({
      nodeName: "test",
      farmContext: mockFarmContext,
    });

    expect(prompt).toContain("mac-main: planner [planner:seasonal]");
    expect(prompt).toContain("jetson-1: field brain [sensor:moisture,actuator:pump]");
  });

  it("includes safety rules", () => {
    const prompt = buildPlannerSystemPrompt({
      nodeName: "test",
      farmContext: mockFarmContext,
    });

    expect(prompt).toContain("No pump run without valid water source");
    expect(prompt).toContain("No actuation from LLM-only evidence");
    expect(prompt).toContain("Manual override always takes priority");
  });

  it("works without farm context", () => {
    const prompt = buildPlannerSystemPrompt({ nodeName: "standalone" });
    expect(prompt).toContain("standalone");
    expect(prompt).not.toContain("Farm:");
    expect(prompt).not.toContain("Zones");
  });

  it("handles zones without crops", () => {
    const prompt = buildPlannerSystemPrompt({
      nodeName: "test",
      farmContext: {
        ...mockFarmContext,
        zones: [{ zoneId: "z1", name: "Empty Zone" }],
      },
    });

    expect(prompt).toContain("z1: Empty Zone");
    expect(prompt).not.toContain("crops:");
  });

  it("handles assets without capabilities", () => {
    const prompt = buildPlannerSystemPrompt({
      nodeName: "test",
      farmContext: {
        ...mockFarmContext,
        assets: [{ assetId: "basic", type: "sensor" }],
      },
    });

    expect(prompt).toContain("basic: sensor");
    expect(prompt).not.toContain("[");
  });
});
