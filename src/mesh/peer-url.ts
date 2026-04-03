import type { MeshStaticPeer, MeshStaticPeerSecurityPosture } from "./types.mesh.js";

const LOCAL_TRANSPORT_LABELS = new Set(["lan", "mdns"]);

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
  const transportLabel = peer.transportLabel?.toLowerCase();
  return !!transportLabel && !LOCAL_TRANSPORT_LABELS.has(transportLabel);
}
