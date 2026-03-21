/**
 * Tests for SystemEventLog — structured audit log for debugging.
 */

import { describe, it, expect } from "vitest";
import { SystemEventLog } from "./system-event-log.js";

describe("SystemEventLog recording", () => {
  it("records events with timestamp", () => {
    const log = new SystemEventLog();
    log.record("startup", "Node started");
    expect(log.size).toBe(1);
    const events = log.recent(1);
    expect(events[0].type).toBe("startup");
    expect(events[0].timestamp).toBeGreaterThan(0);
  });

  it("records events with data", () => {
    const log = new SystemEventLog();
    log.record("peer.connect", "Connected to farm-hub", { deviceId: "abc", capabilities: 3 });
    const events = log.recent(1);
    expect(events[0].data?.deviceId).toBe("abc");
  });

  it("respects capacity limit", () => {
    const log = new SystemEventLog(5);
    for (let i = 0; i < 10; i++) {
      log.record("peer.connect", `Event ${i}`);
    }
    expect(log.size).toBe(5);
    // Should keep the most recent
    expect(log.recent(1)[0].message).toBe("Event 9");
  });
});

describe("SystemEventLog queries", () => {
  it("recent returns newest first", () => {
    const log = new SystemEventLog();
    log.record("peer.connect", "First");
    log.record("peer.disconnect", "Second");
    log.record("error", "Third");
    const events = log.recent(3);
    expect(events[0].message).toBe("Third");
    expect(events[2].message).toBe("First");
  });

  it("byType filters correctly", () => {
    const log = new SystemEventLog();
    log.record("peer.connect", "Connect 1");
    log.record("error", "Error 1");
    log.record("peer.connect", "Connect 2");
    log.record("proposal.created", "Proposal 1");

    const connects = log.byType("peer.connect");
    expect(connects).toHaveLength(2);
    expect(connects[0].message).toBe("Connect 2"); // newest first
  });

  it("since filters by time", () => {
    const log = new SystemEventLog();
    // Manually set timestamps
    (log as any).events = [
      { type: "startup", timestamp: Date.now() - 120_000, message: "Old" },
      { type: "error", timestamp: Date.now() - 30_000, message: "Recent" },
      { type: "peer.connect", timestamp: Date.now() - 10_000, message: "Very recent" },
    ];
    const last60s = log.since(Date.now() - 60_000);
    expect(last60s).toHaveLength(2);
  });
});

describe("SystemEventLog summary", () => {
  it("summarizes events by type", () => {
    const log = new SystemEventLog();
    log.record("peer.connect", "Connect");
    log.record("peer.disconnect", "Disconnect");
    log.record("error", "Error 1");
    log.record("error", "Error 2");
    log.record("proposal.created", "Proposal");

    const summary = log.summary(60);
    expect(summary.total).toBe(5);
    expect(summary.errors).toBe(2);
    expect(summary.peerChanges).toBe(2);
    expect(summary.proposals).toBe(1);
    expect(summary.byType["error"]).toBe(2);
  });

  it("summary respects time window", () => {
    const log = new SystemEventLog();
    (log as any).events = [
      { type: "error", timestamp: Date.now() - 120 * 60_000, message: "Very old" }, // 2 hours ago
      { type: "error", timestamp: Date.now() - 10_000, message: "Recent" },
    ];
    const summary = log.summary(60); // Last 60 minutes
    expect(summary.total).toBe(1);
    expect(summary.errors).toBe(1);
  });

  it("empty log returns zero summary", () => {
    const log = new SystemEventLog();
    const summary = log.summary();
    expect(summary.total).toBe(0);
    expect(summary.errors).toBe(0);
  });
});

describe("SystemEventLog production scenarios", () => {
  it("tracks full peer lifecycle", () => {
    const log = new SystemEventLog();
    log.record("peer.connect", "Connected to sensor-node", { deviceId: "sensor-01" });
    log.record("threshold.breach", "Moisture critical in zone-1", { value: 12 });
    log.record("proposal.created", "Irrigate zone-1", { taskId: "task-abc" });
    log.record("proposal.resolved", "Approved by operator", { taskId: "task-abc", status: "approved" });
    log.record("peer.disconnect", "Sensor-node disconnected", { deviceId: "sensor-01", reason: "timeout" });

    const summary = log.summary();
    expect(summary.peerChanges).toBe(2);
    expect(summary.proposals).toBe(2);
    expect(summary.total).toBe(5);
  });

  it("captures error storm pattern", () => {
    const log = new SystemEventLog();
    for (let i = 0; i < 20; i++) {
      log.record("error", `LLM error ${i}`, { code: "429" });
    }
    log.record("mode.change", "Entering observing mode", { mode: "observing" });

    const summary = log.summary();
    expect(summary.errors).toBe(20);
    expect(log.byType("mode.change")).toHaveLength(1);
  });
});

describe("SystemEventLog wired into runtime", () => {
  it("startup/shutdown events are captured by the event log", () => {
    const log = new SystemEventLog();
    log.record("startup", "Node started", { port: 18789 });
    log.record("shutdown", "Shutting down", { uptime: 3600_000 });
    const events = log.recent();
    expect(events.some(e => e.type === "startup")).toBe(true);
    expect(events.some(e => e.type === "shutdown")).toBe(true);
  });

  it("peer events populate the log via event bus wiring", () => {
    const log = new SystemEventLog();
    log.record("peer.connect", "Connected: sensor-01", { deviceId: "sensor-01" });
    log.record("peer.disconnect", "Disconnected: sensor-01", { deviceId: "sensor-01", reason: "timeout" });
    const summary = log.summary();
    expect(summary.peerChanges).toBe(2);
  });
});
