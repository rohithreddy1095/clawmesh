/**
 * Tests for CLI status command — output formatting validation.
 */

import { describe, it, expect } from "vitest";
import type { HealthCheckResult } from "../mesh/health-check.js";

/** Simulates the status command's output formatting logic. */
function formatHealthOutput(h: Partial<HealthCheckResult>): string[] {
  const lines: string[] = [];
  lines.push(`Status:      ${(h.status ?? "unknown").toUpperCase()}`);
  lines.push(`Node:        ${h.displayName ?? h.nodeId ?? "?"}`);
  lines.push(`Uptime:      ${Math.round((h.uptimeMs ?? 0) / 60_000)}min`);
  lines.push(`Peers:       ${h.peers?.connected ?? 0}`);
  lines.push(`World model: ${h.worldModel?.entries ?? 0} entries`);
  lines.push(`Planner:     ${h.plannerMode ?? "disabled"}`);
  return lines;
}

describe("CLI status output formatting", () => {
  it("formats healthy node status", () => {
    const lines = formatHealthOutput({
      status: "healthy",
      displayName: "farm-hub",
      uptimeMs: 3_600_000,
      peers: { connected: 2, details: [] },
      worldModel: { entries: 15, frameLogSize: 100 },
      plannerMode: "active",
    });
    expect(lines[0]).toContain("HEALTHY");
    expect(lines[1]).toContain("farm-hub");
    expect(lines[2]).toContain("60min");
    expect(lines[3]).toContain("2");
  });

  it("formats degraded node status", () => {
    const lines = formatHealthOutput({
      status: "degraded",
      nodeId: "abc123...",
      uptimeMs: 120_000,
      peers: { connected: 0, details: [] },
      plannerMode: "suspended",
    });
    expect(lines[0]).toContain("DEGRADED");
    expect(lines[5]).toContain("suspended");
  });

  it("formats node without planner", () => {
    const lines = formatHealthOutput({
      status: "healthy",
      displayName: "sensor-node",
      uptimeMs: 600_000,
    });
    expect(lines[5]).toContain("disabled");
  });
});
