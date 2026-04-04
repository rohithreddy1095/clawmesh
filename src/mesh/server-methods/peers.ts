import type { MeshCapabilityRegistry } from "../capabilities.js";
import type { PeerRegistry } from "../peer-registry.js";
import type { PlannerActivity } from "../planner-election.js";
import type { PlannerRuntimeSnapshot } from "../../agents/planner-runtime-state.js";

type HandlerFn = (opts: {
  respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void;
}) => void | Promise<void>;
type GatewayRequestHandlers = Record<string, HandlerFn>;

export function createMeshPeersHandlers(deps: {
  peerRegistry: PeerRegistry;
  capabilityRegistry: MeshCapabilityRegistry;
  localDeviceId: string;
  getPlannerActivity?: () => PlannerActivity;
  getPlannerMode?: () => string | undefined;
  getPlannerModelSpec?: () => string | undefined;
  getPlannerRuntime?: () => PlannerRuntimeSnapshot | undefined;
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
        plannerMode: deps.getPlannerMode?.(),
        plannerModelSpec: deps.getPlannerModelSpec?.(),
        plannerRuntime: deps.getPlannerRuntime?.(),
        discoveryEnabled: deps.isDiscoveryEnabled?.(),
        configuredStaticPeers: deps.getConfiguredStaticPeers?.(),
        pendingProposals: deps.getPendingProposals?.(),
      });
    },
  };
}
