import type { MeshStaticPeer, MeshStaticPeerSecurityPosture } from "./types.mesh.js";

const PINNED_WAN_TRANSPORT_LABELS = new Set(["relay", "vpn"]);

export function normalizeMeshPeerUrl(url: string): string {
  if (url.startsWith("https://")) {
    return `wss://${url.slice("https://".length)}`;
  }
  if (url.startsWith("http://")) {
    return `ws://${url.slice("http://".length)}`;
  }
  return url;
}

export function getMeshStaticPeerSecurityPosture(peer: Pick<MeshStaticPeer, "url" | "tlsFingerprint">): MeshStaticPeerSecurityPosture {
  const url = normalizeMeshPeerUrl(peer.url);
  if (url.startsWith("wss://")) {
    return peer.tlsFingerprint ? "tls-pinned" : "tls-unpinned";
  }
  return "insecure";
}

export function requiresPinnedWanTransport(peer: Pick<MeshStaticPeer, "transportLabel">): boolean {
  return !!peer.transportLabel && PINNED_WAN_TRANSPORT_LABELS.has(peer.transportLabel);
}
