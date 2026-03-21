/**
 * Tests for DataFreshness — sensor data staleness detection.
 *
 * Tests real production scenarios:
 * - Sensor goes offline → data classified as stale/expired
 * - Normal sensor operation → data is fresh
 * - Planner gets warnings about stale data
 */

import { describe, it, expect } from "vitest";
import {
  classifyFreshness,
  formatFreshnessWarning,
  getDataFreshnessWarnings,
  type FreshnessLevel,
} from "./data-freshness.js";

describe("classifyFreshness", () => {
  it("recent data is fresh", () => {
    const now = Date.now();
    expect(classifyFreshness(now - 10_000, now)).toBe("fresh"); // 10s ago, 30s interval
  });

  it("data after 3 missed intervals is aging", () => {
    const now = Date.now();
    // 30s interval, 4 missed = 120s = aging
    expect(classifyFreshness(now - 120_000, now)).toBe("aging");
  });

  it("data after 10 missed intervals is stale", () => {
    const now = Date.now();
    // 30s interval, 11 missed = 330s = stale
    expect(classifyFreshness(now - 330_000, now)).toBe("stale");
  });

  it("data after 60 missed intervals is expired", () => {
    const now = Date.now();
    // 30s interval, 61 missed = 1830s = expired
    expect(classifyFreshness(now - 1_830_000, now)).toBe("expired");
  });

  it("custom interval changes thresholds", () => {
    const now = Date.now();
    // 5-minute interval, 4 missed = 20 min = aging
    expect(classifyFreshness(now - 20 * 60_000, now, {
      expectedIntervalMs: 5 * 60_000,
    })).toBe("aging");
  });

  it("data from just now is fresh", () => {
    const now = Date.now();
    expect(classifyFreshness(now, now)).toBe("fresh");
  });

  it("exact boundary: 3 missed intervals is still fresh", () => {
    const now = Date.now();
    // Exactly 3 intervals = 90s with default 30s
    expect(classifyFreshness(now - 90_000, now)).toBe("fresh");
  });

  it("just over 3 missed intervals is aging", () => {
    const now = Date.now();
    // 3.1 intervals = 93s with default 30s
    expect(classifyFreshness(now - 93_000, now)).toBe("aging");
  });
});

describe("formatFreshnessWarning", () => {
  it("returns null for fresh data", () => {
    expect(formatFreshnessWarning("soil_moisture", "zone-1", "fresh", 10_000)).toBeNull();
  });

  it("aging warning includes metric and zone", () => {
    const warning = formatFreshnessWarning("soil_moisture", "zone-1", "aging", 120_000);
    expect(warning).toContain("zone-1:soil_moisture");
    expect(warning).toContain("2m");
    expect(warning).toContain("⚠");
  });

  it("stale warning is stronger", () => {
    const warning = formatFreshnessWarning("temperature", "zone-2", "stale", 600_000);
    expect(warning).toContain("⚠⚠");
    expect(warning).toContain("STALE");
    expect(warning).toContain("10m");
  });

  it("expired warning mentions sensor offline", () => {
    const warning = formatFreshnessWarning("pressure", undefined, "expired", 3_600_000);
    expect(warning).toContain("🚫");
    expect(warning).toContain("EXPIRED");
    expect(warning).toContain("1h0m");
  });

  it("handles missing zone", () => {
    const warning = formatFreshnessWarning("temp", undefined, "aging", 120_000);
    expect(warning).toContain("temp");
    expect(warning).not.toContain("undefined");
  });
});

describe("getDataFreshnessWarnings", () => {
  it("returns empty for all fresh data", () => {
    const now = Date.now();
    const warnings = getDataFreshnessWarnings([
      { metric: "moisture", zone: "z1", lastUpdated: now - 10_000 },
      { metric: "temp", zone: "z1", lastUpdated: now - 5_000 },
    ], now);
    expect(warnings).toHaveLength(0);
  });

  it("returns warnings for stale entries", () => {
    const now = Date.now();
    const warnings = getDataFreshnessWarnings([
      { metric: "moisture", zone: "z1", lastUpdated: now - 10_000 },        // fresh
      { metric: "temp", zone: "z2", lastUpdated: now - 600_000 },           // stale (10 min, 20 intervals)
      { metric: "pressure", zone: "z1", lastUpdated: now - 3_600_000 },     // expired
    ], now);
    expect(warnings).toHaveLength(2); // temp + pressure
    expect(warnings[0]).toContain("z2:temp");
    expect(warnings[1]).toContain("EXPIRED");
  });

  it("handles custom interval per metric", () => {
    const now = Date.now();
    const warnings = getDataFreshnessWarnings([
      {
        metric: "moisture",
        zone: "z1",
        lastUpdated: now - 300_000, // 5 min ago
        expectedIntervalMs: 60_000, // Expected every minute → 5 missed → stale
      },
    ], now);
    expect(warnings).toHaveLength(1);
  });
});

describe("Production scenario: sensor node offline", () => {
  it("detects sensor going offline progressively", () => {
    const sensorInterval = 30_000; // Reports every 30s
    const lastReport = Date.now() - 15 * 60_000; // 15 minutes ago
    const now = Date.now();

    const level = classifyFreshness(lastReport, now, { expectedIntervalMs: sensorInterval });
    expect(level).toBe("stale"); // 30 missed intervals → stale

    const warning = formatFreshnessWarning("soil_moisture", "zone-1", level, now - lastReport);
    expect(warning).toContain("STALE");
    expect(warning).toContain("15m");
  });

  it("fresh data right after sensor reconnects", () => {
    const now = Date.now();
    const level = classifyFreshness(now - 2000, now, { expectedIntervalMs: 30_000 });
    expect(level).toBe("fresh");
  });
});
