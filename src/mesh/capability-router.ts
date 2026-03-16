/**
 * CapabilityRouter — health-aware capability routing.
 *
 * Extends the basic resolveMeshRoute with structured capability matching
 * and health-aware peer scoring. When multiple peers offer the same
 * capability, the router picks the healthiest one.
 */

import { MeshCapabilityRegistry } from "./capabilities.js";
import {
  parseCapabilityString,
  matchCapability,
  scoreCapability,
  type StructuredCapability,
  type CapabilityHealth,
} from "./capability-types.js";

// ─── Types ──────────────────────────────────────────────────

export type CapabilityRouteResult =
  | { kind: "local" }
  | { kind: "mesh"; peerDeviceId: string; score: number }
  | { kind: "unavailable" };

export type PeerHealthMap = Map<string, Map<string, CapabilityHealth>>;

// ─── Router ─────────────────────────────────────────────────

/**
 * Resolve where to route a capability request, considering health status.
 *
 * Unlike the basic resolveMeshRoute (which returns first match), this router:
 *   1. Checks local capabilities first (local-first)
 *   2. Finds all peers with matching capability
 *   3. Scores each match based on health + exactness
 *   4. Returns the highest-scoring peer
 */
export function resolveCapabilityRoute(params: {
  capability: string;
  capabilityRegistry: MeshCapabilityRegistry;
  localCapabilities?: Set<string>;
  peerHealth?: PeerHealthMap;
}): CapabilityRouteResult {
  const { capability, capabilityRegistry, localCapabilities, peerHealth } = params;

  // Local-first: check if we have the capability locally
  if (localCapabilities) {
    for (const localCap of localCapabilities) {
      if (matchCapability(localCap, capability)) {
        return { kind: "local" };
      }
    }
  }

  // Find all peers with capabilities matching the pattern
  const allPeers = capabilityRegistry.listAll();
  const candidates: Array<{ peerDeviceId: string; cap: StructuredCapability; score: number }> = [];

  for (const peer of allPeers) {
    for (const peerCap of peer.capabilities) {
      if (matchCapability(peerCap, capability)) {
        const structured = parseCapabilityString(peerCap);

        // Apply health from the peer health map
        if (peerHealth) {
          const peerHealthMap = peerHealth.get(peer.deviceId);
          if (peerHealthMap) {
            const health = peerHealthMap.get(peerCap);
            if (health) {
              structured.health = health;
            }
          }
        }

        const score = scoreCapability(structured, capability);
        candidates.push({ peerDeviceId: peer.deviceId, cap: structured, score });
      }
    }
  }

  if (candidates.length === 0) {
    return { kind: "unavailable" };
  }

  // Sort by score descending, pick best
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  return {
    kind: "mesh",
    peerDeviceId: best.peerDeviceId,
    score: best.score,
  };
}

/**
 * Find all peers that can fulfill a capability pattern,
 * sorted by health score (best first).
 */
export function findAllCapabilityPeers(params: {
  capability: string;
  capabilityRegistry: MeshCapabilityRegistry;
  peerHealth?: PeerHealthMap;
}): Array<{ peerDeviceId: string; score: number }> {
  const allPeers = params.capabilityRegistry.listAll();
  const results: Array<{ peerDeviceId: string; score: number }> = [];

  for (const peer of allPeers) {
    for (const peerCap of peer.capabilities) {
      if (matchCapability(peerCap, params.capability)) {
        const structured = parseCapabilityString(peerCap);

        if (params.peerHealth) {
          const healthMap = params.peerHealth.get(peer.deviceId);
          if (healthMap) {
            const health = healthMap.get(peerCap);
            if (health) structured.health = health;
          }
        }

        results.push({
          peerDeviceId: peer.deviceId,
          score: scoreCapability(structured, params.capability),
        });
        break; // One match per peer is enough
      }
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
