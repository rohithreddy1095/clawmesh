import type { MeshStaticPeer, MeshStaticPeerSecurityPosture } from "./types.mesh.js";

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
