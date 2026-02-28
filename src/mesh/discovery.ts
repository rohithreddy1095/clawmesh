import { EventEmitter } from "node:events";
import ciao, { Responder, MDNSServerOptions } from "@homebridge/ciao";

export type MeshDiscoveredPeer = {
  deviceId: string;
  displayName?: string;
  host?: string;
  port?: number;
  discoveredAtMs: number;
};

export type MeshDiscoveryEvents = {
  "peer-discovered": [peer: MeshDiscoveredPeer];
  "peer-lost": [deviceId: string];
};

export class MeshDiscovery extends EventEmitter<MeshDiscoveryEvents> {
  private localDeviceId: string;
  private localPort: number;
  private displayName: string;
  private knownPeers = new Map<string, MeshDiscoveredPeer>();
  private responder: Responder | null = null;
  private service: any = null;

  constructor(opts: {
    localDeviceId: string;
    localPort: number;
    displayName?: string;
  }) {
    super();
    this.localDeviceId = opts.localDeviceId;
    this.localPort = opts.localPort;
    this.displayName = opts.displayName ?? "clawmesh-node";
  }

  start() {
    if (this.responder) {
      return;
    }

    this.responder = ciao.getResponder();

    // Publish our own service
    this.service = this.responder.createService({
      name: this.displayName,
      type: "clawmesh",
      txt: {
        deviceId: this.localDeviceId,
        version: "0.2.0",
      },
      port: this.localPort,
    });

    this.service.advertise().catch((err: Error) => {
      // Ignore advertising errors (e.g. port conflicts in tests)
    });

    // Discover peers
    const browser = this.responder.createServiceBrowser({
      type: "clawmesh",
    });

    browser.on("up", (service) => {
      const deviceId = service.txt?.deviceId;
      if (!deviceId || typeof deviceId !== "string" || deviceId === this.localDeviceId) {
        return;
      }

      if (!this.knownPeers.has(deviceId)) {
        const peer: MeshDiscoveredPeer = {
          deviceId,
          displayName: service.name,
          host: service.addresses?.[0], // IPv4 preferred
          port: service.port,
          discoveredAtMs: Date.now(),
        };
        this.knownPeers.set(deviceId, peer);
        this.emit("peer-discovered", peer);
      }
    });

    browser.on("down", (service) => {
      const deviceId = service.txt?.deviceId;
      if (deviceId && typeof deviceId === "string" && this.knownPeers.has(deviceId)) {
        this.knownPeers.delete(deviceId);
        this.emit("peer-lost", deviceId);
      }
    });

    browser.start();
  }

  stop() {
    if (this.service) {
      this.service.end().catch(() => {});
      this.service = null;
    }
    if (this.responder) {
      this.responder.shutdown().catch(() => {});
      this.responder = null;
    }
  }

  listPeers(): MeshDiscoveredPeer[] {
    return [...this.knownPeers.values()];
  }
}
