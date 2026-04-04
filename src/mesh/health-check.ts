/**
 * Health Check — RPC handler and types for mesh node health reporting.
 *
 * Provides a standard `mesh.health` RPC method that returns:
 *   - Node uptime
 *   - Connected peer count + details
 *   - World model frame count + entry count
 *   - Planner mode (if active)
 *   - Capability summary
 *   - Memory usage (approximate)
 *
 * Useful for monitoring, dashboards, and automated alerting.
 */

import type { PeerRegistry } from "./peer-registry.js";
import type { MeshCapabilityRegistry } from "./capabilities.js";
import type { WorldModel } from "./world-model.js";
import type { RpcHandlerFn, RpcHandlerMap } from "./rpc-dispatcher.js";
import type { MetricSnapshot } from "./metrics-collector.js";
import type { PlannerActivity, PlannerLeader } from "./planner-election.js";
import type { MeshNodeRole } from "./types.js";

// ─── Types ──────────────────────────────────────────────────

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export type PeerHealthInfo = {
  deviceId: string;
  displayName?: string;
  capabilities: string[];
  role?: MeshNodeRole;
  transportLabel?: string;
  connectedMs: number;
  outbound: boolean;
};

export type HealthCheckResult = {
  status: HealthStatus;
  nodeId: string;
  displayName?: string;
  uptimeMs: number;
  startedAt: string;
  peers: {
    connected: number;
    details: PeerHealthInfo[];
  };
  worldModel: {
    entries: number;
    frameLogSize: number;
  };
  capabilities: {
    local: string[];
    meshTotal: number;
  };
  plannerMode?: string;
  plannerModelSpec?: string;
  plannerLeader?: PlannerLeader;
  plannerActivity?: PlannerActivity;
  discoveryEnabled?: boolean;
  configuredStaticPeers?: Array<{
    deviceId: string;
    url: string;
    transportLabel?: string;
    securityPosture?: string;
  }>;
  memoryUsageMB?: number;
  metrics?: MetricSnapshot[];
  version: string;
  timestamp: string;
};

// ─── Health Check Logic ─────────────────────────────────────

export type HealthCheckDeps = {
  nodeId: string;
  displayName?: string;
  startedAtMs: number;
  version: string;
  localCapabilities: string[];
  peerRegistry: PeerRegistry;
  capabilityRegistry: MeshCapabilityRegistry;
  worldModel: WorldModel;
  getPlannerMode?: () => string | undefined;
  getPlannerModelSpec?: () => string | undefined;
  getPlannerLeader?: () => PlannerLeader;
  getPlannerActivity?: () => PlannerActivity;
  isDiscoveryEnabled?: () => boolean;
  getConfiguredStaticPeers?: () => Array<{
    deviceId: string;
    url: string;
    transportLabel?: string;
    securityPosture?: string;
  }>;
  getMetrics?: () => MetricSnapshot[];
};

/**
 * Compute the health check result from runtime dependencies.
 */
export function computeHealthCheck(deps: HealthCheckDeps): HealthCheckResult {
  const now = Date.now();
  const peers = deps.peerRegistry.listConnected();

  const peerDetails: PeerHealthInfo[] = peers.map((p) => ({
    deviceId: p.deviceId.slice(0, 16) + "...",
    displayName: p.displayName,
    capabilities: p.capabilities,
    role: p.role,
    transportLabel: p.transportLabel,
    connectedMs: now - p.connectedAtMs,
    outbound: p.outbound,
  }));

  const allCaps = deps.capabilityRegistry.listAll();
  const meshCapCount = allCaps.reduce((sum, c) => sum + c.capabilities.length, 0);

  // Determine overall status
  let status: HealthStatus = "healthy";
  if (peers.length === 0 && deps.localCapabilities.length === 0) {
    status = "degraded"; // No peers and no local capabilities
  }
  const plannerMode = deps.getPlannerMode?.();
  if (plannerMode === "suspended") {
    status = "degraded";
  }

  // Approximate memory usage
  let memoryUsageMB: number | undefined;
  try {
    const usage = process.memoryUsage();
    memoryUsageMB = Math.round((usage.heapUsed / 1024 / 1024) * 10) / 10;
  } catch {
    // process.memoryUsage might not be available in all environments
  }

  return {
    status,
    nodeId: deps.nodeId.slice(0, 16) + "...",
    displayName: deps.displayName,
    uptimeMs: now - deps.startedAtMs,
    startedAt: new Date(deps.startedAtMs).toISOString(),
    peers: {
      connected: peers.length,
      details: peerDetails,
    },
    worldModel: {
      entries: deps.worldModel.size,
      frameLogSize: deps.worldModel.getRecentFrames(10000).length,
    },
    capabilities: {
      local: deps.localCapabilities,
      meshTotal: meshCapCount,
    },
    plannerMode,
    plannerModelSpec: deps.getPlannerModelSpec?.(),
    plannerLeader: deps.getPlannerLeader?.(),
    plannerActivity: deps.getPlannerActivity?.(),
    discoveryEnabled: deps.isDiscoveryEnabled?.(),
    configuredStaticPeers: deps.getConfiguredStaticPeers?.(),
    memoryUsageMB,
    metrics: deps.getMetrics?.(),
    version: deps.version,
    timestamp: new Date(now).toISOString(),
  };
}

/**
 * Create the `mesh.health` RPC handler.
 */
export function createHealthCheckHandlers(deps: HealthCheckDeps): RpcHandlerMap {
  return {
    "mesh.health": (({ respond }) => {
      const result = computeHealthCheck(deps);
      respond(true, result);
    }) as RpcHandlerFn,
  };
}
