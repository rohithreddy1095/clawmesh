/**
 * Tests for TUI data building logic — extracted pure functions
 * from MeshTUI for testability.
 *
 * Tests fmtUptime, gossip column data formatting, and peer column logic
 * without requiring terminal rendering.
 */

import { describe, it, expect } from "vitest";
import { strip, dw, pad, trunc, fit } from "./ansi.js";

// ── fmtUptime (extracted logic) ────────────────────────

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  return `${m}m${String(sec).padStart(2, "0")}s`;
}

describe("fmtUptime (TUI uptime formatting)", () => {
  it("formats zero", () => {
    expect(fmtUptime(0)).toBe("0m00s");
  });

  it("formats seconds only", () => {
    expect(fmtUptime(45_000)).toBe("0m45s");
  });

  it("formats minutes and seconds", () => {
    expect(fmtUptime(125_000)).toBe("2m05s");
  });

  it("formats hours and minutes", () => {
    expect(fmtUptime(3_700_000)).toBe("1h01m");
  });

  it("formats large hours", () => {
    expect(fmtUptime(36_000_000)).toBe("10h00m");
  });

  it("formats 1 second", () => {
    expect(fmtUptime(1000)).toBe("0m01s");
  });

  it("formats exactly 1 hour", () => {
    expect(fmtUptime(3_600_000)).toBe("1h00m");
  });

  it("rounds down sub-second", () => {
    expect(fmtUptime(999)).toBe("0m00s");
    expect(fmtUptime(1500)).toBe("0m01s");
  });
});

// ── Gossip column data formatting ──────────────────────

const kindShort: Record<string, string> = {
  observation: "obs",
  event: "evt",
  human_input: "inp",
  inference: "inf",
  capability_update: "cap",
};

function compactDataSummary(d: Record<string, unknown>): string {
  if (d.zone && d.metric && d.value !== undefined) {
    return `${d.zone} ${d.metric}=${d.value}${d.unit ?? ""}`;
  } else if (d.intent) {
    return String(d.intent).slice(0, 30);
  } else if (d.decision) {
    return String(d.decision).slice(0, 30);
  } else if (d.reasoning) {
    return String(d.reasoning).slice(0, 30);
  } else {
    const json = JSON.stringify(d);
    return json.length > 32 ? json.slice(0, 30) + "…" : json;
  }
}

describe("Gossip column data formatting", () => {
  it("formats observation with metric/value/zone", () => {
    expect(compactDataSummary({
      zone: "zone-1",
      metric: "soil_moisture",
      value: 42,
      unit: "%",
    })).toBe("zone-1 soil_moisture=42%");
  });

  it("formats observation without unit", () => {
    expect(compactDataSummary({
      zone: "zone-2",
      metric: "temperature",
      value: 35,
    })).toBe("zone-2 temperature=35");
  });

  it("formats intent data", () => {
    expect(compactDataSummary({ intent: "check irrigation status" })).toBe("check irrigation status");
  });

  it("truncates long intents", () => {
    const long = "a".repeat(50);
    expect(compactDataSummary({ intent: long })).toHaveLength(30);
  });

  it("formats decision data", () => {
    expect(compactDataSummary({ decision: "irrigate zone-1" })).toBe("irrigate zone-1");
  });

  it("formats reasoning data", () => {
    expect(compactDataSummary({ reasoning: "soil is dry" })).toBe("soil is dry");
  });

  it("formats unknown data as JSON", () => {
    expect(compactDataSummary({ foo: "bar" })).toBe('{"foo":"bar"}');
  });

  it("truncates long JSON", () => {
    const data: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) data[`key${i}`] = `value${i}`;
    const result = compactDataSummary(data);
    expect(result.length).toBeLessThanOrEqual(31); // 30 + "…"
    expect(result).toContain("…");
  });

  it("maps kind to short form", () => {
    expect(kindShort["observation"]).toBe("obs");
    expect(kindShort["event"]).toBe("evt");
    expect(kindShort["human_input"]).toBe("inp");
    expect(kindShort["inference"]).toBe("inf");
    expect(kindShort["capability_update"]).toBe("cap");
  });
});

// ── ANSI helpers used in TUI ───────────────────────────

describe("ANSI helpers in TUI rendering", () => {
  it("strip removes ANSI codes for width calculation", () => {
    expect(strip("\x1b[32mgreen\x1b[0m")).toBe("green");
  });

  it("dw calculates display width", () => {
    expect(dw("hello")).toBe(5);
    expect(dw("\x1b[31mred\x1b[0m")).toBe(3);
  });

  it("pad right-pads to width", () => {
    const result = pad("hi", 6);
    expect(strip(result)).toBe("hi    ");
  });

  it("trunc truncates to max width", () => {
    expect(strip(trunc("hello world", 5))).toBe("hell…");
  });

  it("fit combines pad and trunc", () => {
    expect(strip(fit("hi", 6))).toBe("hi    ");
    expect(strip(fit("hello world", 5))).toBe("hell…");
  });
});
