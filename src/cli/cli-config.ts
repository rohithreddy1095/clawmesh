/**
 * CLI configuration helpers — pure functions extracted from clawmesh-cli.ts.
 *
 * Handles:
 * - Shorthand flag expansion
 * - Default threshold rule generation
 * - CLI option normalization
 */

import type { ThresholdRule } from "../agents/types.js";
import type { MeshNodeRole } from "../mesh/types.js";
import type { MeshStaticPeer } from "../mesh/types.mesh.js";
import { getMeshStaticPeerSecurityPosture } from "../mesh/peer-url.js";

export interface CLIShorthandOpts {
  fieldNode?: boolean;
  commandCenter?: boolean;
  sensors?: boolean;
  actuators?: boolean;
  piPlanner?: boolean;
  mockSensor?: boolean;
  mockActuator?: boolean;
}

/**
 * Expand shorthand CLI flags into their full equivalents.
 * Mutates the options object in place.
 *
 * - --field-node → --sensors --actuators
 * - --command-center → --pi-planner
 * - --sensors → --mock-sensor
 * - --actuators → --mock-actuator
 */
export function expandShorthandFlags(opts: CLIShorthandOpts): CLIShorthandOpts {
  const result = { ...opts };
  if (result.fieldNode) {
    result.sensors = true;
    result.actuators = true;
  }
  if (result.commandCenter) {
    result.piPlanner = true;
  }
  if (result.sensors) {
    result.mockSensor = true;
  }
  if (result.actuators) {
    result.mockActuator = true;
  }
  return result;
}

/**
 * Default threshold rules for auto-triggering the planner.
 */
export function getDefaultThresholds(): ThresholdRule[] {
  return [
    {
      ruleId: "moisture-critical",
      metric: "moisture",
      belowThreshold: 20,
      cooldownMs: 300_000,
      promptHint: "Soil moisture has dropped below 20% — evaluate irrigation need",
    },
    {
      ruleId: "moisture-low",
      metric: "moisture",
      belowThreshold: 25,
      cooldownMs: 600_000,
      promptHint: "Soil moisture is below 25% — monitor and consider scheduling irrigation",
    },
  ];
}

/**
 * Parse a numeric CLI option string, returning a default on invalid input.
 */
export function parseNumericOption(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = Number(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Validate that required environment variables are set.
 * Returns a list of missing variable names.
 */
export function checkRequiredEnvVars(
  vars: string[],
  env: Record<string, string | undefined> = process.env,
): string[] {
  return vars.filter((v) => !env[v]);
}

/**
 * Generate a display name from identity and explicit name.
 */
export function resolveDisplayName(
  explicitName: string | undefined,
  hostname: string,
): string {
  return explicitName ?? hostname;
}

/**
 * Format a device ID for display (truncate to 12 chars + ellipsis).
 */
export function formatDeviceId(deviceId: string): string {
  if (deviceId.length <= 12) return deviceId;
  return `${deviceId.slice(0, 12)}…`;
}

/**
 * Build the default capabilities list based on enabled features.
 */
export function buildDefaultCapabilities(opts: {
  mockActuator?: boolean;
  mockSensor?: boolean;
  capabilities?: string[];
}): string[] {
  const caps = [...(opts.capabilities ?? [])];
  if (opts.mockActuator && !caps.includes("channel:clawmesh")) {
    caps.push("channel:clawmesh");
  }
  if (opts.mockActuator && !caps.includes("actuator:mock")) {
    caps.push("actuator:mock");
  }
  if (opts.mockSensor && !caps.includes("sensor:mock")) {
    caps.push("sensor:mock");
  }
  return caps;
}

const VALID_RUNTIME_ROLES: MeshNodeRole[] = [
  "node",
  "planner",
  "field",
  "sensor",
  "actuator",
  "viewer",
  "standby-planner",
];

export function resolveRuntimeRole(role: string | undefined): MeshNodeRole {
  if (!role) return "node";
  return (VALID_RUNTIME_ROLES.includes(role as MeshNodeRole) ? role : "node") as MeshNodeRole;
}

export function normalizeMeshName(name: string | undefined): string | undefined {
  const trimmed = name?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveDiscoveryEnabledOption(opts: { discovery?: boolean; noDiscovery?: boolean }): boolean {
  if (typeof opts.discovery === "boolean") {
    return opts.discovery;
  }
  if (typeof opts.noDiscovery === "boolean") {
    return !opts.noDiscovery;
  }
  return true;
}

export function formatDiscoveryMode(enabled: boolean): string {
  return enabled ? "enabled (mDNS)" : "disabled (static/WAN)";
}

export function formatStaticPeerSummary(peer: Pick<MeshStaticPeer, "deviceId" | "url" | "transportLabel" | "tlsFingerprint">): string {
  return `${formatDeviceId(peer.deviceId)}  ${peer.url}${peer.transportLabel ? `  via ${peer.transportLabel}` : ""}  ${getMeshStaticPeerSecurityPosture(peer)}`;
}
