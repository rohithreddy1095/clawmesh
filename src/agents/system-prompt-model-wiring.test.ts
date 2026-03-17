/**
 * Tests for SystemPromptBuilder + resolveModel wiring in PiSession.
 *
 * Validates the system prompt delegation and model spec parsing.
 */

import { describe, it, expect } from "vitest";
import { buildPlannerSystemPrompt } from "./system-prompt-builder.js";
import { parseModelSpec } from "./planner-prompt-builder.js";
import type { FarmContext } from "./types.js";

describe("SystemPromptBuilder wiring in PiSession", () => {
  it("builds prompt with node name only", () => {
    const prompt = buildPlannerSystemPrompt({ nodeName: "farm-hub-01" });
    expect(prompt).toContain("farm-hub-01");
    expect(prompt).toContain("planner / command center");
    expect(prompt).toContain("propose_task");
    expect(prompt).not.toContain("Farm:");
  });

  it("builds prompt with full farm context", () => {
    const farmContext: FarmContext = {
      siteName: "Bhoomi Natural Farm",
      zones: [
        { zoneId: "z1", name: "Mango Orchard", crops: ["Alphonso mango"] },
        { zoneId: "z2", name: "Spice Garden" },
      ],
      assets: [
        { assetId: "pump-01", type: "irrigation_pump", capabilities: ["irrigate", "set_flow"] },
      ],
      safetyRules: [
        "Never irrigate during active rainfall",
        "Max flow rate 100L/min for drip lines",
      ],
      operations: [
        { name: "irrigate", description: "Start irrigation", approvalLevel: "L2" },
      ],
    };

    const prompt = buildPlannerSystemPrompt({ nodeName: "hub", farmContext });
    expect(prompt).toContain("Bhoomi Natural Farm");
    expect(prompt).toContain("Mango Orchard");
    expect(prompt).toContain("Alphonso mango");
    expect(prompt).toContain("pump-01");
    expect(prompt).toContain("irrigate,set_flow");
    expect(prompt).toContain("Never irrigate during active rainfall");
  });

  it("zones without crops omit crop list", () => {
    const farmContext: FarmContext = {
      siteName: "Test Farm",
      zones: [{ zoneId: "z1", name: "Empty Zone" }],
      assets: [],
      safetyRules: [],
      operations: [],
    };
    const prompt = buildPlannerSystemPrompt({ nodeName: "n1", farmContext });
    expect(prompt).toContain("Empty Zone");
    expect(prompt).not.toContain("crops:");
  });
});

describe("parseModelSpec wiring in PiSession.resolveModel", () => {
  it("parses valid provider/model specs", () => {
    const result = parseModelSpec("anthropic/claude-sonnet-4-5-20250929");
    expect(result.provider).toBe("anthropic");
    expect(result.modelId).toBe("claude-sonnet-4-5-20250929");
  });

  it("handles nested model IDs with slashes", () => {
    const result = parseModelSpec("openai/gpt-4/turbo");
    expect(result.provider).toBe("openai");
    expect(result.modelId).toBe("gpt-4/turbo");
  });

  it("throws on missing model ID", () => {
    expect(() => parseModelSpec("anthropic")).toThrow("Invalid model spec");
  });

  it("throws on empty string", () => {
    expect(() => parseModelSpec("")).toThrow("Invalid model spec");
  });

  it("throws on slash only", () => {
    expect(() => parseModelSpec("/")).toThrow("Invalid model spec");
  });
});
