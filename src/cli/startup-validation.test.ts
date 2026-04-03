/**
 * Tests for startup validation — pre-flight checks for production deployment.
 */

import { describe, it, expect } from "vitest";
import {
  validateStartupConfig,
  hasBlockingDiagnostics,
  formatDiagnostics,
  type StartupValidationInput,
} from "./startup-validation.js";

describe("validateStartupConfig", () => {
  it("returns empty for valid minimal config", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "device-abc123",
      port: 18789,
      capabilities: ["sensor:moisture"],
    });
    expect(diagnostics.filter(d => d.level === "error")).toHaveLength(0);
  });

  it("errors on missing device identity", () => {
    const diagnostics = validateStartupConfig({});
    expect(diagnostics.some(d => d.code === "NO_IDENTITY")).toBe(true);
  });

  it("errors on invalid port", () => {
    const diagnostics = validateStartupConfig({ deviceId: "d1", port: 99999 });
    expect(diagnostics.some(d => d.code === "INVALID_PORT")).toBe(true);
  });

  it("warns on privileged port", () => {
    const diagnostics = validateStartupConfig({ deviceId: "d1", port: 80 });
    expect(diagnostics.some(d => d.code === "PRIVILEGED_PORT")).toBe(true);
  });

  it("port 0 (auto-assign) is valid and not privileged", () => {
    const diagnostics = validateStartupConfig({ deviceId: "d1", port: 0 });
    expect(diagnostics.some(d => d.code === "INVALID_PORT")).toBe(false);
    expect(diagnostics.some(d => d.code === "PRIVILEGED_PORT")).toBe(false);
  });

  it("errors on invalid peer URL", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      staticPeers: [{ deviceId: "d2", url: "ftp://wrong-protocol" }],
    });
    expect(diagnostics.some(d => d.code === "INVALID_PEER_URL")).toBe(true);
  });

  it("warns on self-referencing peer", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      staticPeers: [{ deviceId: "d1", url: "ws://localhost:18789" }],
    });
    expect(diagnostics.some(d => d.code === "SELF_PEER")).toBe(true);
  });

  it("info on no static peers", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      staticPeers: [],
    });
    expect(diagnostics.some(d => d.code === "NO_STATIC_PEERS")).toBe(true);
  });

  it("warns when discovery is disabled and no static peers are configured", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      staticPeers: [],
      discoveryEnabled: false,
    });
    expect(diagnostics.some(d => d.code === "ISOLATED_NODE")).toBe(true);
    expect(diagnostics.some(d => d.code === "NO_STATIC_PEERS")).toBe(false);
  });

  it("reports configured static peer transport labels", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      staticPeers: [
        { deviceId: "peer-a", url: "wss://relay.example.com/mesh", transportLabel: "relay" },
        { deviceId: "peer-b", url: "ws://10.0.0.5:18789", transportLabel: "lan" },
      ],
    });
    expect(diagnostics.some(d => d.code === "STATIC_PEER_TRANSPORTS" && d.message.includes("relay, lan"))).toBe(true);
  });

  it("accepts normalized relay peer websocket URLs", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      staticPeers: [
        { deviceId: "peer-a", url: "wss://relay.example.com/mesh", transportLabel: "relay" },
      ],
    });
    expect(diagnostics.some(d => d.code === "INVALID_PEER_URL")).toBe(false);
  });

  it("accepts relay peer URLs normalized from https", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      staticPeers: [
        { deviceId: "peer-a", url: "https://relay.example.com/mesh", transportLabel: "relay" },
      ],
    });
    expect(diagnostics.some(d => d.code === "INVALID_PEER_URL")).toBe(false);
  });

  it("warns when discovery is disabled and static peers have no transport labels", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      discoveryEnabled: false,
      staticPeers: [
        { deviceId: "peer-a", url: "wss://relay.example.com/mesh" },
      ],
    });
    expect(diagnostics.some(d => d.code === "UNLABELED_STATIC_PEER_TRANSPORT")).toBe(true);
  });

  it("warns when a relay peer has no TLS fingerprint", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      staticPeers: [
        { deviceId: "peer-a", url: "wss://relay.example.com/mesh", transportLabel: "relay" },
      ],
    });
    expect(diagnostics.some(d => d.code === "MISSING_TLS_FINGERPRINT")).toBe(true);
  });

  it("does not warn when a relay peer includes TLS fingerprint pinning", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      staticPeers: [
        {
          deviceId: "peer-a",
          url: "wss://relay.example.com/mesh",
          transportLabel: "relay",
          tlsFingerprint: "sha256:AABBCCDD",
        },
      ],
    });
    expect(diagnostics.some(d => d.code === "MISSING_TLS_FINGERPRINT")).toBe(false);
  });

  it("warns when a relay peer uses insecure ws transport", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      staticPeers: [
        {
          deviceId: "peer-a",
          url: "ws://relay.example.com/mesh",
          transportLabel: "relay",
        },
      ],
    });
    expect(diagnostics.some(d => d.code === "INSECURE_RELAY_TRANSPORT")).toBe(true);
  });

  it("does not warn about insecure relay transport for non-relay ws peers", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      staticPeers: [
        {
          deviceId: "peer-a",
          url: "ws://10.0.0.5:18789",
          transportLabel: "lan",
        },
      ],
    });
    expect(diagnostics.some(d => d.code === "INSECURE_RELAY_TRANSPORT")).toBe(false);
  });

  it("info on no capabilities", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      capabilities: [],
    });
    expect(diagnostics.some(d => d.code === "NO_CAPABILITIES")).toBe(true);
  });

  it("warns on duplicate threshold rule IDs", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      thresholds: [
        { ruleId: "r1", metric: "m1" },
        { ruleId: "r1", metric: "m2" },
      ],
    });
    expect(diagnostics.some(d => d.code === "DUPLICATE_RULE_ID")).toBe(true);
  });

  it("warns on missing rule ID", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      thresholds: [{ metric: "m1" }],
    });
    expect(diagnostics.some(d => d.code === "MISSING_RULE_ID")).toBe(true);
  });

  it("warns on missing rule metric", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      thresholds: [{ ruleId: "r1" }],
    });
    expect(diagnostics.some(d => d.code === "MISSING_RULE_METRIC")).toBe(true);
  });

  it("warns on Pi planner without API key", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      enablePiSession: true,
      hasApiKey: false,
    });
    expect(diagnostics.some(d => d.code === "NO_API_KEY")).toBe(true);
  });

  it("errors on invalid model spec format", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      enablePiSession: true,
      hasApiKey: true,
      modelSpec: "just-a-model-name",
    });
    expect(diagnostics.some(d => d.code === "INVALID_MODEL_SPEC")).toBe(true);
  });

  it("valid model spec passes", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      enablePiSession: true,
      hasApiKey: true,
      modelSpec: "anthropic/claude-sonnet-4-5-20250929",
    });
    expect(diagnostics.some(d => d.code === "INVALID_MODEL_SPEC")).toBe(false);
  });
});

describe("hasBlockingDiagnostics", () => {
  it("returns true when errors present", () => {
    const diagnostics = validateStartupConfig({});
    expect(hasBlockingDiagnostics(diagnostics)).toBe(true);
  });

  it("returns false for warnings only", () => {
    const diagnostics = validateStartupConfig({
      deviceId: "d1",
      port: 80,
    });
    expect(hasBlockingDiagnostics(diagnostics)).toBe(false);
  });

  it("returns false for empty diagnostics", () => {
    expect(hasBlockingDiagnostics([])).toBe(false);
  });
});

describe("formatDiagnostics", () => {
  it("returns success message for empty diagnostics", () => {
    expect(formatDiagnostics([])).toContain("All pre-flight checks passed");
  });

  it("uses ✗ for errors", () => {
    const result = formatDiagnostics([{ level: "error", code: "TEST", message: "bad" }]);
    expect(result).toContain("✗");
  });

  it("uses ⚠ for warnings", () => {
    const result = formatDiagnostics([{ level: "warn", code: "TEST", message: "careful" }]);
    expect(result).toContain("⚠");
  });

  it("uses ℹ for info", () => {
    const result = formatDiagnostics([{ level: "info", code: "TEST", message: "fyi" }]);
    expect(result).toContain("ℹ");
  });

  it("includes diagnostic code", () => {
    const result = formatDiagnostics([{ level: "error", code: "MY_CODE", message: "msg" }]);
    expect(result).toContain("[MY_CODE]");
  });
});
