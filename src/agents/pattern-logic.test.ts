import { describe, it, expect } from "vitest";
import {
  calculateConfidence,
  meetsExportThreshold,
  patternKey,
  decayConfidence,
  shouldRemovePattern,
  matchesQuery,
} from "./pattern-logic.js";

// ─── calculateConfidence ────────────────────────────

describe("calculateConfidence", () => {
  it("returns 0 for zero total", () => {
    expect(calculateConfidence(0, 0)).toBe(0);
  });

  it("returns 1.0 for all approvals", () => {
    expect(calculateConfidence(5, 0)).toBe(1.0);
  });

  it("returns 0 for all rejections", () => {
    expect(calculateConfidence(0, 5)).toBe(0);
  });

  it("returns 0.5 for equal approvals/rejections", () => {
    expect(calculateConfidence(3, 3)).toBe(0.5);
  });

  it("returns correct ratio", () => {
    expect(calculateConfidence(3, 1)).toBe(0.75);
  });

  it("handles large numbers", () => {
    expect(calculateConfidence(1000, 0)).toBe(1.0);
  });
});

// ─── meetsExportThreshold ───────────────────────────

describe("meetsExportThreshold", () => {
  it("meets threshold with 3 approvals and 2 events", () => {
    expect(meetsExportThreshold({
      approvalCount: 3,
      distinctTriggerEvents: ["a", "b"],
    })).toBe(true);
  });

  it("fails with insufficient approvals", () => {
    expect(meetsExportThreshold({
      approvalCount: 2,
      distinctTriggerEvents: ["a", "b"],
    })).toBe(false);
  });

  it("fails with insufficient trigger events", () => {
    expect(meetsExportThreshold({
      approvalCount: 5,
      distinctTriggerEvents: ["a"],
    })).toBe(false);
  });

  it("fails with zero of both", () => {
    expect(meetsExportThreshold({
      approvalCount: 0,
      distinctTriggerEvents: [],
    })).toBe(false);
  });

  it("meets with excess of both", () => {
    expect(meetsExportThreshold({
      approvalCount: 10,
      distinctTriggerEvents: ["a", "b", "c", "d"],
    })).toBe(true);
  });
});

// ─── patternKey ─────────────────────────────────────

describe("patternKey", () => {
  it("generates pipe-separated key", () => {
    expect(patternKey("moisture < 20%", "start", "actuator:pump:P1"))
      .toBe("moisture < 20%|start|actuator:pump:P1");
  });

  it("handles empty strings", () => {
    expect(patternKey("", "", "")).toBe("||");
  });

  it("handles special characters", () => {
    expect(patternKey("temp > 40°C", "set", "actuator:valve|V1"))
      .toBe("temp > 40°C|set|actuator:valve|V1");
  });
});

// ─── decayConfidence ────────────────────────────────

describe("decayConfidence", () => {
  it("no decay within window", () => {
    const now = Date.now();
    const result = decayConfidence(0.8, now - 1000, now, 7 * 24 * 3600_000);
    expect(result).toBe(0.8);
  });

  it("decays after one window", () => {
    const now = Date.now();
    const oneWindow = 7 * 24 * 3600_000;
    const result = decayConfidence(1.0, now - oneWindow * 1.5, now, oneWindow, 0.9);
    expect(result).toBe(0.9); // one period elapsed
  });

  it("decays more after multiple windows", () => {
    const now = Date.now();
    const oneWindow = 7 * 24 * 3600_000;
    const result = decayConfidence(1.0, now - oneWindow * 3, now, oneWindow, 0.9);
    expect(result).toBeCloseTo(0.729, 2); // 0.9^3
  });

  it("never goes below 0", () => {
    const now = Date.now();
    const result = decayConfidence(0.01, now - 1e12, now, 1000, 0.1);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it("handles zero confidence", () => {
    expect(decayConfidence(0, 0, Date.now())).toBe(0);
  });

  it("custom window and factor", () => {
    const now = Date.now();
    const result = decayConfidence(1.0, now - 20_000, now, 10_000, 0.5);
    expect(result).toBe(0.25); // 0.5^2
  });
});

// ─── shouldRemovePattern ────────────────────────────

describe("shouldRemovePattern", () => {
  it("removes below min confidence", () => {
    expect(shouldRemovePattern(0.05)).toBe(true);
  });

  it("keeps above min confidence", () => {
    expect(shouldRemovePattern(0.5)).toBe(false);
  });

  it("keeps at exactly min confidence", () => {
    expect(shouldRemovePattern(0.1)).toBe(false);
  });

  it("custom min confidence", () => {
    expect(shouldRemovePattern(0.3, 0.5)).toBe(true);
    expect(shouldRemovePattern(0.6, 0.5)).toBe(false);
  });
});

// ─── matchesQuery ───────────────────────────────────

describe("matchesQuery", () => {
  const pattern = {
    metric: "moisture",
    zone: "zone-1",
    triggerCondition: "moisture below 20%",
  };

  it("matches when all criteria match", () => {
    expect(matchesQuery(pattern, { metric: "moisture", zone: "zone-1" })).toBe(true);
  });

  it("matches with no criteria (empty query)", () => {
    expect(matchesQuery(pattern, {})).toBe(true);
  });

  it("fails on metric mismatch", () => {
    expect(matchesQuery(pattern, { metric: "temperature" })).toBe(false);
  });

  it("fails on zone mismatch", () => {
    expect(matchesQuery(pattern, { zone: "zone-2" })).toBe(false);
  });

  it("matches partial triggerCondition", () => {
    expect(matchesQuery(pattern, { triggerCondition: "moisture" })).toBe(true);
  });

  it("fails on triggerCondition mismatch", () => {
    expect(matchesQuery(pattern, { triggerCondition: "temperature" })).toBe(false);
  });

  it("skips metric check when pattern has no metric", () => {
    const noMetric = { triggerCondition: "test" };
    expect(matchesQuery(noMetric, { metric: "anything" })).toBe(true);
  });

  it("skips zone check when pattern has no zone", () => {
    const noZone = { triggerCondition: "test" };
    expect(matchesQuery(noZone, { zone: "any" })).toBe(true);
  });
});
