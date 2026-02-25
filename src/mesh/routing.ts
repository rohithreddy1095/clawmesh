import type { MeshCapabilityRegistry } from "./capabilities.js";

export type MeshRouteResult =
  | { kind: "local" }
  | { kind: "mesh"; peerDeviceId: string }
  | { kind: "unavailable" };

/**
 * Resolve where to send a message for a given channel.
 * In ClawMesh, local availability is checked via a capability set
 * rather than the channel plugin registry (which is stripped).
 */
export function resolveMeshRoute(params: {
  channel: string;
  capabilityRegistry: MeshCapabilityRegistry;
  localCapabilities?: Set<string>;
}): MeshRouteResult {
  // Check if the channel is available locally via capability set.
  if (params.localCapabilities?.has(`channel:${params.channel}`)) {
    return { kind: "local" };
  }

  // Check mesh peers for the channel capability.
  const peerDeviceId = params.capabilityRegistry.findPeerWithChannel(params.channel);
  if (peerDeviceId) {
    return { kind: "mesh", peerDeviceId };
  }

  return { kind: "unavailable" };
}
