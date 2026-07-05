import { EventEmitter } from "node:events";
import ciao, { Responder } from "@homebridge/ciao";
import { Bonjour, type Browser as BonjourBrowser, type Service as BonjourService } from "bonjour-service";

const CLAWMESH_MDNS_SERVICE_TYPE = "clawmesh";
const CLAWMESH_VERSION = "0.2.0";

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
  private bonjour: InstanceType<typeof Bonjour> | null = null;
  private browser: BonjourBrowser | null = null;

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
      type: CLAWMESH_MDNS_SERVICE_TYPE,
      txt: {
        deviceId: this.localDeviceId,
        version: CLAWMESH_VERSION,
      },
      port: this.localPort,
    });

    this.service.advertise().catch((err: Error) => {
      // Ignore advertising errors (e.g. port conflicts in tests)
    });

    // ciao is advertise-only for this use case; bonjour-service supplies browse.
    const bonjour = new Bonjour();
    const browser = bonjour.find({
      type: CLAWMESH_MDNS_SERVICE_TYPE,
    });
    this.bonjour = bonjour;
    this.browser = browser;

    browser.on("up", (service) => {
      const peer = this.toDiscoveredPeer(service);
      if (!peer) {
        return;
      }

      if (!this.knownPeers.has(peer.deviceId)) {
        this.knownPeers.set(peer.deviceId, peer);
        this.emit("peer-discovered", peer);
      }
    });

    browser.on("down", (service) => {
      const deviceId = readTxtString(service.txt, "deviceId");
      if (deviceId && typeof deviceId === "string" && this.knownPeers.has(deviceId)) {
        this.knownPeers.delete(deviceId);
        this.emit("peer-lost", deviceId);
      }
    });

    browser.start();
  }

  stop() {
    if (this.browser) {
      this.browser.stop();
      this.browser = null;
    }
    if (this.bonjour) {
      this.bonjour.destroy(() => {});
      this.bonjour = null;
    }
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

  private toDiscoveredPeer(service: BonjourService): MeshDiscoveredPeer | null {
    const deviceId = readTxtString(service.txt, "deviceId");
    if (!deviceId || deviceId === this.localDeviceId) {
      return null;
    }

    return {
      deviceId,
      displayName: service.name,
      host: chooseServiceHost(service),
      port: service.port,
      discoveredAtMs: Date.now(),
    };
  }
}

function readTxtString(txt: unknown, key: string): string | undefined {
  if (!txt || typeof txt !== "object") {
    return undefined;
  }

  const value = (txt as Record<string, unknown>)[key];
  if (typeof value === "string") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        return item;
      }
      if (Buffer.isBuffer(item)) {
        return item.toString("utf8");
      }
    }
  }
  return undefined;
}

function chooseServiceHost(service: BonjourService): string | undefined {
  const addresses = Array.isArray(service.addresses) ? service.addresses : [];
  return addresses.find((address) => !address.includes(":")) ?? addresses[0] ?? service.host;
}
