/**
 * Tests for CorrelationTracker — causal chain tracing.
 */

import { describe, it, expect } from "vitest";
import { CorrelationTracker } from "./correlation-tracker.js";

describe("CorrelationTracker", () => {
  it("tracks a simple chain", () => {
    const tracker = new CorrelationTracker();
    tracker.start("frame-001", "sensor", "Moisture reading: 12%");
    tracker.addStep("frame-001", "threshold", "Breached: moisture < 20%");
    tracker.addStep("frame-001", "planner", "Triggered planner cycle");
    tracker.addStep("frame-001", "proposal", "Created: irrigate zone-1");

    const chain = tracker.get("frame-001");
    expect(chain).not.toBeUndefined();
    expect(chain!.steps).toHaveLength(4);
    expect(chain!.steps[0].stage).toBe("sensor");
    expect(chain!.steps[3].stage).toBe("proposal");
  });

  it("formats chain as human-readable trace", () => {
    const tracker = new CorrelationTracker();
    tracker.start("f1", "sensor", "Moisture 12%");
    tracker.addStep("f1", "threshold", "Breach detected");

    const trace = tracker.formatChain("f1");
    expect(trace).toContain("1. [sensor]");
    expect(trace).toContain("2. [threshold]");
    expect(trace).toContain("Moisture 12%");
  });

  it("returns null for unknown chain", () => {
    const tracker = new CorrelationTracker();
    expect(tracker.formatChain("unknown")).toBeNull();
  });

  it("addStep silently skips untracked origins", () => {
    const tracker = new CorrelationTracker();
    tracker.addStep("nonexistent", "stage", "detail"); // No crash
    expect(tracker.size).toBe(0);
  });

  it("findByStage returns matching chains", () => {
    const tracker = new CorrelationTracker();
    tracker.start("f1", "sensor", "Reading 1");
    tracker.addStep("f1", "proposal", "Created");
    tracker.start("f2", "sensor", "Reading 2");
    // f2 has no proposal step

    const withProposal = tracker.findByStage("proposal");
    expect(withProposal).toHaveLength(1);
    expect(withProposal[0].originId).toBe("f1");
  });

  it("respects maxChains capacity", () => {
    const tracker = new CorrelationTracker(3);
    tracker.start("f1", "s", "d");
    tracker.start("f2", "s", "d");
    tracker.start("f3", "s", "d");
    tracker.start("f4", "s", "d"); // Evicts f1

    expect(tracker.size).toBe(3);
    expect(tracker.get("f1")).toBeUndefined();
    expect(tracker.get("f4")).not.toBeUndefined();
  });

  it("chain includes data payload", () => {
    const tracker = new CorrelationTracker();
    tracker.start("f1", "sensor", "Reading", { value: 12, zone: "zone-1" });

    const chain = tracker.get("f1");
    expect(chain!.steps[0].data?.value).toBe(12);
  });

  it("clear removes all chains", () => {
    const tracker = new CorrelationTracker();
    tracker.start("f1", "s", "d");
    tracker.start("f2", "s", "d");
    tracker.clear();
    expect(tracker.size).toBe(0);
  });
});

describe("CorrelationTracker production scenario", () => {
  it("traces sensor → threshold → planner → proposal → approve → execute", () => {
    const tracker = new CorrelationTracker();

    // 1. Sensor reading arrives
    tracker.start("frame-moisture-001", "sensor.ingest", "zone-1 soil_moisture=12%", { value: 12 });

    // 2. Threshold breached
    tracker.addStep("frame-moisture-001", "threshold.breach", "moisture-critical: value 12 < 20");

    // 3. Planner triggered
    tracker.addStep("frame-moisture-001", "planner.trigger", "Queued threshold_breach for planner cycle");

    // 4. Proposal created
    tracker.addStep("frame-moisture-001", "proposal.created", "task-abc: Irrigate zone-1 (L2)");

    // 5. Operator approves
    tracker.addStep("frame-moisture-001", "proposal.approved", "Approved by operator-tui");

    // 6. Actuation executed
    tracker.addStep("frame-moisture-001", "actuation.executed", "pump:P1 start — 30min duration");

    const chain = tracker.get("frame-moisture-001")!;
    expect(chain.steps).toHaveLength(6);

    const trace = tracker.formatChain("frame-moisture-001")!;
    expect(trace).toContain("[sensor.ingest]");
    expect(trace).toContain("[actuation.executed]");
    expect(trace).toContain("pump:P1");
  });
});
