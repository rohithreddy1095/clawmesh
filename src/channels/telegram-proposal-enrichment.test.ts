/**
 * Tests for Telegram proposal notification enrichment.
 */

import { describe, it, expect } from "vitest";
import type { ContextFrame } from "../mesh/context-types.js";

// Simulates the enrichment logic from telegram.ts
function buildSensorContext(
  frames: ContextFrame[],
  targetRef: string,
): string[] {
  const targetZone = targetRef.split(":").find(p => p.startsWith("zone-"));
  return frames
    .filter(f => f.kind === "observation" && (!targetZone || f.data.zone === targetZone))
    .slice(0, 3)
    .map(f => `${f.data.zone ?? ""}:${f.data.metric}=${f.data.value}${f.data.unit ?? ""}`)
    .filter(Boolean);
}

function makeFrame(data: Record<string, unknown>): ContextFrame {
  return {
    kind: "observation",
    frameId: `f-${Math.random().toString(36).slice(2)}`,
    sourceDeviceId: "s1",
    timestamp: Date.now(),
    data,
    trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
  };
}

describe("Telegram proposal sensor context enrichment", () => {
  it("includes relevant zone readings", () => {
    const frames = [
      makeFrame({ metric: "soil_moisture", value: 12, zone: "zone-1", unit: "%" }),
      makeFrame({ metric: "temperature", value: 35, zone: "zone-1" }),
      makeFrame({ metric: "humidity", value: 65, zone: "zone-2" }),
    ];
    const readings = buildSensorContext(frames, "actuator:pump:zone-1:P1");
    expect(readings).toHaveLength(2); // Only zone-1
    expect(readings[0]).toContain("soil_moisture=12%");
  });

  it("returns empty for no matching frames", () => {
    const frames = [
      makeFrame({ metric: "humidity", value: 65, zone: "zone-2" }),
    ];
    const readings = buildSensorContext(frames, "actuator:pump:zone-1:P1");
    expect(readings).toHaveLength(0);
  });

  it("limits to 3 readings", () => {
    const frames = Array.from({ length: 10 }, (_, i) =>
      makeFrame({ metric: `m${i}`, value: i, zone: "zone-1" }),
    );
    const readings = buildSensorContext(frames, "actuator:pump:zone-1:P1");
    expect(readings).toHaveLength(3);
  });

  it("includes all zones when targetRef has no zone", () => {
    const frames = [
      makeFrame({ metric: "m1", value: 1, zone: "zone-1" }),
      makeFrame({ metric: "m2", value: 2, zone: "zone-2" }),
    ];
    const readings = buildSensorContext(frames, "actuator:backup:system");
    expect(readings).toHaveLength(2);
  });
});
