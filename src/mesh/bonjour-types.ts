/**
 * Beacon data returned from mDNS/Bonjour service discovery.
 * Used by MeshDiscovery to identify peer gateways on the LAN.
 */
export type GatewayBonjourBeacon = {
  instanceName: string;
  domain?: string;
  displayName?: string;
  host?: string;
  port?: number;
  lanHost?: string;
  tailnetDns?: string;
  gatewayPort?: number;
  sshPort?: number;
  gatewayTls?: boolean;
  gatewayTlsFingerprintSha256?: string;
  cliPath?: string;
  role?: string;
  transport?: string;
  /** Device identity ID (SHA256 of Ed25519 public key) for mesh peer discovery. */
  deviceId?: string;
  txt?: Record<string, string>;
};
