/**
 * Tests for TUI event formatting — validates the events display logic.
 */

import { describe, it, expect } from "vitest";
import { SystemEventLog } from "../mesh/system-event-log.js";

describe("TUI events command formatting", () => {
  it("formats recent events as compact one-liner", () => {
    const log = new SystemEventLog();
    log.record("peer.connect", "Connected to sensor-node");
    log.record("threshold.breach", "Moisture critical zone-1");

    const events = log.recent(5);
    const formatted = events.map(ev => {
      const time = new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `${time} [${ev.type}] ${ev.message.slice(0, 45)}`;
    });

    expect(formatted).toHaveLength(2);
    expect(formatted[0]).toContain("threshold.breach");
    expect(formatted[1]).toContain("peer.connect");
  });

  it("handles empty event log gracefully", () => {
    const log = new SystemEventLog();
    expect(log.recent(5)).toHaveLength(0);
  });
});
