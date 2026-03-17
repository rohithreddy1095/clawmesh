import { describe, it, expect } from "vitest";
import {
  simulateMoistureStep,
  classifyMoistureStatus,
  clamp,
  buildObservationPayload,
  buildObservationNote,
} from "./sensor-simulation.js";

// ─── classifyMoistureStatus ─────────────────────────

describe("classifyMoistureStatus", () => {
  it("critical below 20%", () => {
    expect(classifyMoistureStatus(15)).toBe("critical");
    expect(classifyMoistureStatus(19.9)).toBe("critical");
    expect(classifyMoistureStatus(0)).toBe("critical");
  });

  it("low between 20% and 25%", () => {
    expect(classifyMoistureStatus(20)).toBe("low");
    expect(classifyMoistureStatus(24.9)).toBe("low");
  });

  it("normal at 25% and above", () => {
    expect(classifyMoistureStatus(25)).toBe("normal");
    expect(classifyMoistureStatus(35)).toBe("normal");
    expect(classifyMoistureStatus(100)).toBe("normal");
  });

  it("boundary at 20 is low (not critical)", () => {
    expect(classifyMoistureStatus(20)).toBe("low");
  });

  it("boundary at 25 is normal (not low)", () => {
    expect(classifyMoistureStatus(25)).toBe("normal");
  });
});

// ─── simulateMoistureStep ───────────────────────────

describe("simulateMoistureStep", () => {
  it("decreases with positive drying rate and no jitter", () => {
    const result = simulateMoistureStep(30, 1.0, 0);
    expect(result).toBe(29.0);
  });

  it("applies jitter", () => {
    const result = simulateMoistureStep(30, 0, 0.5);
    expect(result).toBe(30.5);
  });

  it("resets to 35 when below 5", () => {
    const result = simulateMoistureStep(4, 2, 0);
    expect(result).toBe(35);
  });

  it("clamps at 40 when above", () => {
    const result = simulateMoistureStep(40, -2, 0); // drying rate negative = increase
    expect(result).toBe(40);
  });

  it("returns float with one decimal", () => {
    const result = simulateMoistureStep(30, 0.33, 0);
    expect(result.toString()).toMatch(/^\d+\.\d$/);
  });

  it("handles zero current", () => {
    const result = simulateMoistureStep(0, 1, 0);
    expect(result).toBe(35); // irrigation reset
  });

  it("random defaults produce reasonable range", () => {
    // Run multiple times, result should be near 30
    const results = Array.from({ length: 100 }, () =>
      simulateMoistureStep(30),
    );
    const allReasonable = results.every(r => r >= 5 && r <= 40);
    expect(allReasonable).toBe(true);
  });
});

// ─── clamp ──────────────────────────────────────────

describe("clamp", () => {
  it("returns value when in range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to min", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps to max", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("handles min equals max", () => {
    expect(clamp(5, 5, 5)).toBe(5);
  });

  it("handles negative ranges", () => {
    expect(clamp(0, -10, -5)).toBe(-5);
  });
});

// ─── buildObservationPayload ────────────────────────

describe("buildObservationPayload", () => {
  it("builds moisture observation with auto-status", () => {
    const payload = buildObservationPayload({
      zone: "zone-1",
      metric: "moisture",
      value: 15,
      unit: "%",
    });
    expect(payload.status).toBe("critical");
    expect(payload.zone).toBe("zone-1");
    expect(payload.metric).toBe("moisture");
    expect(payload.value).toBe(15);
  });

  it("normal moisture status", () => {
    const payload = buildObservationPayload({
      zone: "zone-1",
      metric: "moisture",
      value: 30,
      unit: "%",
    });
    expect(payload.status).toBe("normal");
  });

  it("low moisture status", () => {
    const payload = buildObservationPayload({
      zone: "zone-2",
      metric: "moisture",
      value: 22,
      unit: "%",
    });
    expect(payload.status).toBe("low");
  });

  it("non-moisture metric with threshold", () => {
    const payload = buildObservationPayload({
      zone: "zone-1",
      metric: "temperature",
      value: 15,
      unit: "°C",
      threshold: 20,
    });
    expect(payload.status).toBe("critical"); // below threshold
  });

  it("non-moisture metric normal", () => {
    const payload = buildObservationPayload({
      zone: "zone-1",
      metric: "temperature",
      value: 25,
      unit: "°C",
      threshold: 20,
    });
    expect(payload.status).toBe("normal");
  });

  it("includes optional threshold", () => {
    const payload = buildObservationPayload({
      zone: "z",
      metric: "m",
      value: 50,
      unit: "",
      threshold: 30,
    });
    expect(payload.threshold).toBe(30);
  });
});

// ─── buildObservationNote ───────────────────────────

describe("buildObservationNote", () => {
  it("builds readable note", () => {
    const note = buildObservationNote("zone-1", "moisture", 42, "%", "normal");
    expect(note).toBe("Moisture in zone-1: 42% (normal)");
  });

  it("capitalizes metric name", () => {
    const note = buildObservationNote("z1", "temperature", 30, "°C", "normal");
    expect(note).toContain("Temperature");
  });

  it("handles single-char metric", () => {
    const note = buildObservationNote("z", "p", 7.0, "", "normal");
    expect(note).toBe("P in z: 7 (normal)");
  });
});
