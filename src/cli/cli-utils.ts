/**
 * CLI utility functions — extracted from clawmesh-cli.ts for testability.
 *
 * These handle peer spec parsing, option collection, and env file loading.
 */

import type { MeshStaticPeer } from "../mesh/types.mesh.js";

/**
 * Parse a peer specification string into a MeshStaticPeer.
 *
 * Formats:
 *   "<deviceId>=<ws://host:port>"
 *   "<deviceId>=<wss://host:port>|<tlsFingerprint>"
 *   "<deviceId>@<ws://host:port>"
 *
 * @throws Error if the spec is invalid
 */
export function parsePeerSpec(spec: string): MeshStaticPeer {
  const trimmed = spec.trim();
  const separator = trimmed.includes("=") ? "=" : "@";
  const sepIndex = trimmed.indexOf(separator);
  if (sepIndex <= 0 || sepIndex >= trimmed.length - 1) {
    throw new Error(`invalid peer spec "${spec}" (use "<deviceId>=<ws://host:port>")`);
  }
  const deviceIdRaw = trimmed.slice(0, sepIndex);
  const restRaw = trimmed.slice(sepIndex + 1);
  const [urlRaw, tlsFingerprint] = restRaw.split("|");
  const deviceId = deviceIdRaw.trim();
  const url = urlRaw?.trim();
  if (!deviceId || !url) {
    throw new Error(`invalid peer spec "${spec}" (use "<deviceId>=<ws://host:port>")`);
  }
  return {
    deviceId,
    url,
    tlsFingerprint: tlsFingerprint?.trim() || undefined,
  };
}

/**
 * Commander option collector — accumulates repeated --flag values into an array.
 */
export function collectOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/**
 * Validate a peer spec string without throwing (returns error message or null).
 */
export function validatePeerSpec(spec: string): string | null {
  try {
    parsePeerSpec(spec);
    return null;
  } catch (err) {
    return String((err as Error).message);
  }
}
