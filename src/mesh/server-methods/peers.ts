import type { MeshCapabilityRegistry } from "../capabilities.js";
import type { PeerRegistry } from "../peer-registry.js";
import type { PlannerActivity } from "../planner-election.js";

type HandlerFn = (opts: {
  respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void;
}) => void | Promise<void>;
type GatewayRequestHandlers = Record<string, HandlerFn>;

export function createMeshPeersHandlers(deps: {
  peerRegistry: PeerRegistry;
  capabilityRegistry: MeshCapabilityRegistry;
  localDeviceId: string;
  getPlannerActivity?: () => PlannerActivity;
  isDiscoveryEnabled?: () => boolean;
  getConfiguredStaticPeers?: () => Array<{
    deviceId: string;
    url: string;
    transportLabel?: string;
    securityPosture?: string;
  }>;
  getPendingProposals?: () => Array<{
    taskId: string;
    summary: string;
    approvalLevel: string;
    status: string;
    plannerDeviceId?: string;
    plannerRole?: string;
    plannerOwner?: string;
  }>;
}): GatewayRequestHandlers {
  return {
    "mesh.peers": async ({ respond }) => {
      const peers = deps.peerRegistry.listConnected().map((p) => ({
        deviceId: p.deviceId,
        displayName: p.displayName,
        outbound: p.outbound,
        capabilities: p.capabilities,
        role: p.role,
        transportLabel: p.transportLabel,
        connectedAtMs: p.connectedAtMs,
      }));
      respond(true, { peers });
    },

    "mesh.status": async ({ respond }) => {
      const connected = deps.peerRegistry.listConnected();
      respond(true, {
        localDeviceId: deps.localDeviceId,
        connectedPeers: connected.length,
        peers: connected.map((p) => ({
          deviceId: p.deviceId,
          displayName: p.displayName,
          outbound: p.outbound,
          role: p.role,
          transportLabel: p.transportLabel,
          connectedAtMs: p.connectedAtMs,
        })),
        plannerActivity: deps.getPlannerActivity?.(),
        discoveryEnabled: deps.isDiscoveryEnabled?.(),
        configuredStaticPeers: deps.getConfiguredStaticPeers?.(),
        pendingProposals: deps.getPendingProposals?.(),
      });
    },
  };
}
