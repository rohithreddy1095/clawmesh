import { describe, it, expect } from "vitest";
import {
  parseCapabilityString,
  capabilityToString,
  matchCapability,
  scoreCapability,
  type StructuredCapability,
} from "./capability-types.js";

describe("parseCapabilityString", () => {
  it("parses channel capability", () => {
    const cap = parseCapabilityString("channel:telegram");
    expect(cap.kind).toBe("channel");
    expect(cap.name).toBe("telegram");
    expect(cap.subName).toBeUndefined();
    expect(cap.id).toBe("channel:telegram");
  });

  it("parses actuator with sub-name", () => {
    const cap = parseCapabilityString("actuator:pump:P1");
    expect(cap.kind).toBe("actuator");
    expect(cap.name).toBe("pump");
    expect(cap.subName).toBe("P1");
  });

  it("parses sensor with wildcard sub-name", () => {
    const cap = parseCapabilityString("sensor:soil-moisture:*");
    expect(cap.kind).toBe("sensor");
    expect(cap.name).toBe("soil-moisture");
    expect(cap.subName).toBe("*");
  });

  it("parses skill capability", () => {
    const cap = parseCapabilityString("skill:weather");
    expect(cap.kind).toBe("skill");
    expect(cap.name).toBe("weather");
  });

  it("handles unknown kind as custom", () => {
    const cap = parseCapabilityString("custom-thing");
    expect(cap.kind).toBe("custom");
    expect(cap.name).toBe("custom-thing");
  });

  it("handles multi-colon sub-names", () => {
    const cap = parseCapabilityString("actuator:relay:board:3:pin:7");
    expect(cap.kind).toBe("actuator");
    expect(cap.name).toBe("relay");
    expect(cap.subName).toBe("board:3:pin:7");
  });

  it("sets health to unknown by default", () => {
    const cap = parseCapabilityString("channel:telegram");
    expect(cap.health).toBe("unknown");
  });
});

describe("capabilityToString", () => {
  it("returns the original id", () => {
    const cap = parseCapabilityString("actuator:pump:P1");
    expect(capabilityToString(cap)).toBe("actuator:pump:P1");
  });
});

describe("matchCapability", () => {
  it("exact match", () => {
    expect(matchCapability("actuator:pump:P1", "actuator:pump:P1")).toBe(true);
  });

  it("wildcard at end", () => {
    expect(matchCapability("actuator:pump:P1", "actuator:pump:*")).toBe(true);
  });

  it("wildcard at kind level", () => {
    expect(matchCapability("actuator:pump:P1", "actuator:*")).toBe(true);
  });

  it("no match for different kind", () => {
    expect(matchCapability("channel:telegram", "actuator:*")).toBe(false);
  });

  it("no match for different name", () => {
    expect(matchCapability("actuator:pump:P1", "actuator:valve:*")).toBe(false);
  });

  it("no match when pattern is longer", () => {
    expect(matchCapability("actuator:pump", "actuator:pump:P1")).toBe(false);
  });

  it("matches exact single-segment", () => {
    expect(matchCapability("custom-thing", "custom-thing")).toBe(true);
  });

  it("no match for different single-segment", () => {
    expect(matchCapability("custom-a", "custom-b")).toBe(false);
  });
});

describe("scoreCapability", () => {
  it("healthy capability scores higher than unhealthy", () => {
    const healthy: StructuredCapability = {
      id: "actuator:pump:P1",
      kind: "actuator",
      name: "pump",
      health: "healthy",
    };
    const unhealthy: StructuredCapability = {
      ...healthy,
      health: "unhealthy",
    };

    expect(scoreCapability(healthy, "actuator:pump:P1")).toBeGreaterThan(
      scoreCapability(unhealthy, "actuator:pump:P1"),
    );
  });

  it("exact match gets bonus", () => {
    const cap: StructuredCapability = {
      id: "actuator:pump:P1",
      kind: "actuator",
      name: "pump",
      health: "healthy",
    };

    const exactScore = scoreCapability(cap, "actuator:pump:P1");
    const wildcardScore = scoreCapability(cap, "actuator:pump:*");
    expect(exactScore).toBeGreaterThan(wildcardScore);
  });

  it("degraded scores between healthy and unhealthy", () => {
    const base: StructuredCapability = {
      id: "sensor:temp",
      kind: "sensor",
      name: "temp",
      health: "degraded",
    };

    const healthyScore = scoreCapability({ ...base, health: "healthy" }, "sensor:temp");
    const degradedScore = scoreCapability(base, "sensor:temp");
    const unhealthyScore = scoreCapability({ ...base, health: "unhealthy" }, "sensor:temp");

    expect(healthyScore).toBeGreaterThan(degradedScore);
    expect(degradedScore).toBeGreaterThan(unhealthyScore);
  });
});
