import { describe, it, expect } from "vitest";
import {
  expandShorthandFlags,
  getDefaultThresholds,
  parseNumericOption,
  checkRequiredEnvVars,
  resolveDisplayName,
  formatDeviceId,
  buildDefaultCapabilities,
  resolveRuntimeRole,
  normalizeMeshName,
  formatDiscoveryMode,
  formatStaticPeerSummary,
} from "./cli-config.js";

// ─── expandShorthandFlags ───────────────────────────

describe("expandShorthandFlags", () => {
  it("expands fieldNode to sensors + actuators", () => {
    const result = expandShorthandFlags({ fieldNode: true });
    expect(result.sensors).toBe(true);
    expect(result.actuators).toBe(true);
    expect(result.mockSensor).toBe(true);
    expect(result.mockActuator).toBe(true);
  });

  it("expands commandCenter to piPlanner", () => {
    const result = expandShorthandFlags({ commandCenter: true });
    expect(result.piPlanner).toBe(true);
  });

  it("expands sensors to mockSensor", () => {
    const result = expandShorthandFlags({ sensors: true });
    expect(result.mockSensor).toBe(true);
  });

  it("expands actuators to mockActuator", () => {
    const result = expandShorthandFlags({ actuators: true });
    expect(result.mockActuator).toBe(true);
  });

  it("preserves existing flags", () => {
    const result = expandShorthandFlags({ piPlanner: true, mockSensor: true });
    expect(result.piPlanner).toBe(true);
    expect(result.mockSensor).toBe(true);
  });

  it("empty opts return empty result", () => {
    const result = expandShorthandFlags({});
    expect(result.mockSensor).toBeUndefined();
    expect(result.mockActuator).toBeUndefined();
    expect(result.piPlanner).toBeUndefined();
  });

  it("does not mutate input", () => {
    const input = { fieldNode: true };
    const result = expandShorthandFlags(input);
    expect(input).not.toBe(result);
    expect((input as any).mockSensor).toBeUndefined();
  });

  it("full field node + command center combo", () => {
    const result = expandShorthandFlags({ fieldNode: true, commandCenter: true });
    expect(result.sensors).toBe(true);
    expect(result.actuators).toBe(true);
    expect(result.mockSensor).toBe(true);
    expect(result.mockActuator).toBe(true);
    expect(result.piPlanner).toBe(true);
  });
});

// ─── getDefaultThresholds ───────────────────────────

describe("getDefaultThresholds", () => {
  it("returns two threshold rules", () => {
    const rules = getDefaultThresholds();
    expect(rules).toHaveLength(2);
  });

  it("first rule is moisture-critical at 20", () => {
    const rules = getDefaultThresholds();
    expect(rules[0].ruleId).toBe("moisture-critical");
    expect(rules[0].belowThreshold).toBe(20);
    expect(rules[0].metric).toBe("moisture");
  });

  it("second rule is moisture-low at 25", () => {
    const rules = getDefaultThresholds();
    expect(rules[1].ruleId).toBe("moisture-low");
    expect(rules[1].belowThreshold).toBe(25);
  });

  it("critical has shorter cooldown than low", () => {
    const rules = getDefaultThresholds();
    expect(rules[0].cooldownMs!).toBeLessThan(rules[1].cooldownMs!);
  });

  it("returns new array each call", () => {
    const a = getDefaultThresholds();
    const b = getDefaultThresholds();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ─── parseNumericOption ─────────────────────────────

describe("parseNumericOption", () => {
  it("parses valid number", () => {
    expect(parseNumericOption("42", 0)).toBe(42);
  });

  it("returns default for undefined", () => {
    expect(parseNumericOption(undefined, 100)).toBe(100);
  });

  it("returns default for NaN", () => {
    expect(parseNumericOption("abc", 50)).toBe(50);
  });

  it("returns default for empty string", () => {
    expect(parseNumericOption("", 10)).toBe(10);
  });

  it("handles float", () => {
    expect(parseNumericOption("3.14", 0)).toBe(3.14);
  });

  it("handles negative numbers", () => {
    expect(parseNumericOption("-5", 0)).toBe(-5);
  });
});

// ─── checkRequiredEnvVars ───────────────────────────

describe("checkRequiredEnvVars", () => {
  it("returns empty for all set vars", () => {
    expect(checkRequiredEnvVars(["A", "B"], { A: "1", B: "2" })).toEqual([]);
  });

  it("returns missing vars", () => {
    expect(checkRequiredEnvVars(["A", "B", "C"], { A: "1" })).toEqual(["B", "C"]);
  });

  it("returns all when none set", () => {
    expect(checkRequiredEnvVars(["X", "Y"], {})).toEqual(["X", "Y"]);
  });

  it("returns empty for empty requirements", () => {
    expect(checkRequiredEnvVars([], {})).toEqual([]);
  });

  it("treats undefined value as missing", () => {
    expect(checkRequiredEnvVars(["A"], { A: undefined })).toEqual(["A"]);
  });
});

// ─── resolveDisplayName ─────────────────────────────

describe("resolveDisplayName", () => {
  it("uses explicit name when provided", () => {
    expect(resolveDisplayName("custom", "hostname")).toBe("custom");
  });

  it("falls back to hostname", () => {
    expect(resolveDisplayName(undefined, "myhost")).toBe("myhost");
  });
});

// ─── formatDeviceId ─────────────────────────────────

describe("formatDeviceId", () => {
  it("truncates long device ID", () => {
    expect(formatDeviceId("abcdef123456789xyz")).toBe("abcdef123456…");
  });

  it("keeps short device ID as-is", () => {
    expect(formatDeviceId("abc")).toBe("abc");
  });

  it("keeps exactly 12 chars as-is", () => {
    expect(formatDeviceId("abcdef123456")).toBe("abcdef123456");
  });
});

// ─── buildDefaultCapabilities ───────────────────────

describe("buildDefaultCapabilities", () => {
  it("adds actuator capabilities when mock-actuator enabled", () => {
    const caps = buildDefaultCapabilities({ mockActuator: true });
    expect(caps).toContain("channel:clawmesh");
    expect(caps).toContain("actuator:mock");
  });

  it("adds sensor capability when mock-sensor enabled", () => {
    const caps = buildDefaultCapabilities({ mockSensor: true });
    expect(caps).toContain("sensor:mock");
  });

  it("preserves explicit capabilities", () => {
    const caps = buildDefaultCapabilities({
      capabilities: ["custom:cap"],
      mockActuator: true,
    });
    expect(caps).toContain("custom:cap");
    expect(caps).toContain("channel:clawmesh");
  });

  it("does not duplicate existing capabilities", () => {
    const caps = buildDefaultCapabilities({
      capabilities: ["channel:clawmesh"],
      mockActuator: true,
    });
    const count = caps.filter((c) => c === "channel:clawmesh").length;
    expect(count).toBe(1);
  });

  it("returns empty when nothing enabled", () => {
    expect(buildDefaultCapabilities({})).toEqual([]);
  });

  it("combines all features", () => {
    const caps = buildDefaultCapabilities({
      capabilities: ["custom:x"],
      mockActuator: true,
      mockSensor: true,
    });
    expect(caps).toContain("custom:x");
    expect(caps).toContain("channel:clawmesh");
    expect(caps).toContain("actuator:mock");
    expect(caps).toContain("sensor:mock");
  });
});

// ─── resolveRuntimeRole / normalizeMeshName ───────────────

describe("resolveRuntimeRole", () => {
  it("keeps valid roles", () => {
    expect(resolveRuntimeRole("planner")).toBe("planner");
    expect(resolveRuntimeRole("viewer")).toBe("viewer");
  });

  it("defaults invalid roles to node", () => {
    expect(resolveRuntimeRole("admin")).toBe("node");
  });

  it("defaults undefined role to node", () => {
    expect(resolveRuntimeRole(undefined)).toBe("node");
  });
});

describe("normalizeMeshName", () => {
  it("trims valid names", () => {
    expect(normalizeMeshName("  bhoomi-main  ")).toBe("bhoomi-main");
  });

  it("returns undefined for blank names", () => {
    expect(normalizeMeshName("   ")).toBeUndefined();
  });
});

describe("formatDiscoveryMode", () => {
  it("formats enabled discovery", () => {
    expect(formatDiscoveryMode(true)).toBe("enabled (mDNS)");
  });

  it("formats disabled discovery", () => {
    expect(formatDiscoveryMode(false)).toBe("disabled (static/WAN)");
  });
});

describe("formatStaticPeerSummary", () => {
  it("includes transport label when present", () => {
    expect(formatStaticPeerSummary({
      deviceId: "abcdef1234567890",
      url: "wss://relay.example.com/mesh",
      transportLabel: "relay",
    })).toBe("abcdef123456…  wss://relay.example.com/mesh  via relay");
  });

  it("omits transport label when absent", () => {
    expect(formatStaticPeerSummary({
      deviceId: "abcdef1234567890",
      url: "ws://10.0.0.5:18789",
    })).toBe("abcdef123456…  ws://10.0.0.5:18789");
  });
});
