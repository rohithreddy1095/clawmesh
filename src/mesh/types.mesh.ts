export type MeshStaticPeer = {
  /** WebSocket URL of the remote gateway (e.g. "wss://jetson.local:18789"). */
  url: string;
  /** Expected device ID (SHA256 of Ed25519 public key) for mutual authentication. */
  deviceId: string;
  /** Optional TLS certificate fingerprint for pinning. */
  tlsFingerprint?: string;
};

export type MeshGatewayTarget = {
  /** Human-readable name for this gateway (e.g. "jetson"). */
  name: string;
  /** WebSocket URL of the remote gateway (e.g. "ws://192.168.1.39:18789"). */
  url: string;
  /** Gateway auth password (if password mode). */
  password?: string;
  /** Gateway auth token (if token mode). */
  token?: string;
  /** Role to request when connecting. Default: "node". */
  role?: string;
  /** Scopes to request. Default: ["mesh:connect"]. */
  scopes?: string[];
  /** Display name for this client. */
  displayName?: string;
};

export type MeshConfig = {
  /** Enable the Neural Mesh Protocol. Default: false. */
  enabled?: boolean;
  /** mDNS scan interval in milliseconds. Default: 30000. */
  scanIntervalMs?: number;
  /** Capabilities advertised by this gateway (e.g. channel names, skills). */
  capabilities?: string[];
  /** Statically configured peers (for environments without mDNS). */
  peers?: MeshStaticPeer[];
  /** Remote gateway targets for `clawmesh gateway-connect`. */
  gateways?: MeshGatewayTarget[];
};
