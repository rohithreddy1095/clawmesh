/**
 * Structured Capability Types — evolves flat capability strings into
 * rich objects with version, health, and metadata.
 *
 * Backward compatible: parseCapabilityString converts legacy strings like
 * "channel:telegram" into StructuredCapability objects. The existing
 * MeshCapabilityRegistry continues working with flat strings while new code
 * can use the structured format.
 */

// ─── Types ──────────────────────────────────────────────────

export type CapabilityKind = "channel" | "skill" | "actuator" | "sensor" | "custom";

export type CapabilityHealth = "healthy" | "degraded" | "unhealthy" | "unknown";

export type StructuredCapability = {
  /** Full capability string (e.g. "channel:telegram"). */
  id: string;
  /** The kind extracted from the prefix. */
  kind: CapabilityKind;
  /** The specific name after the kind prefix. */
  name: string;
  /** Optional sub-name for hierarchical capabilities (e.g. "P1" in "actuator:pump:P1"). */
  subName?: string;
  /** Version of this capability. */
  version?: string;
  /** Current health status. */
  health: CapabilityHealth;
  /** Arbitrary metadata (e.g., sensor accuracy, actuator range). */
  metadata?: Record<string, unknown>;
};

// ─── Parsing ────────────────────────────────────────────────

const KNOWN_KINDS = new Set<CapabilityKind>(["channel", "skill", "actuator", "sensor"]);

/**
 * Parse a flat capability string into a StructuredCapability.
 *
 * Examples:
 *   "channel:telegram"       → { kind: "channel", name: "telegram" }
 *   "actuator:pump:P1"       → { kind: "actuator", name: "pump", subName: "P1" }
 *   "sensor:soil-moisture:*"  → { kind: "sensor", name: "soil-moisture", subName: "*" }
 *   "custom-thing"           → { kind: "custom", name: "custom-thing" }
 */
export function parseCapabilityString(cap: string): StructuredCapability {
  const parts = cap.split(":");
  const firstPart = parts[0];

  if (KNOWN_KINDS.has(firstPart as CapabilityKind) && parts.length >= 2) {
    return {
      id: cap,
      kind: firstPart as CapabilityKind,
      name: parts[1],
      subName: parts.length > 2 ? parts.slice(2).join(":") : undefined,
      health: "unknown",
    };
  }

  return {
    id: cap,
    kind: "custom",
    name: cap,
    health: "unknown",
  };
}

/**
 * Convert a StructuredCapability back to a flat string.
 */
export function capabilityToString(cap: StructuredCapability): string {
  return cap.id;
}

// ─── Matching ───────────────────────────────────────────────

/**
 * Check if a capability matches a pattern.
 * Supports exact match, prefix match with wildcard (*), and kind match.
 *
 * Examples:
 *   matchCapability("actuator:pump:P1", "actuator:pump:P1") → true (exact)
 *   matchCapability("actuator:pump:P1", "actuator:pump:*")  → true (wildcard)
 *   matchCapability("actuator:pump:P1", "actuator:*")       → true (kind match)
 *   matchCapability("channel:telegram", "actuator:*")       → false
 */
export function matchCapability(capability: string, pattern: string): boolean {
  if (capability === pattern) return true;

  const capParts = capability.split(":");
  const patParts = pattern.split(":");

  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i] === "*") return true; // Wildcard matches everything from here
    if (i >= capParts.length) return false; // Pattern is longer than capability
    if (capParts[i] !== patParts[i]) return false; // Mismatch
  }

  return capParts.length === patParts.length;
}

// ─── Scoring ────────────────────────────────────────────────

/**
 * Score a capability for routing preference.
 * Higher score = preferred for routing.
 *
 * Factors:
 *   - Health: healthy=10, degraded=5, unhealthy=0, unknown=3
 *   - Exact match bonus: +5 for exact string match
 */
export function scoreCapability(
  cap: StructuredCapability,
  requestedPattern: string,
): number {
  let score = 0;

  // Health score
  const healthScores: Record<CapabilityHealth, number> = {
    healthy: 10,
    degraded: 5,
    unknown: 3,
    unhealthy: 0,
  };
  score += healthScores[cap.health];

  // Exact match bonus
  if (cap.id === requestedPattern) {
    score += 5;
  }

  return score;
}
