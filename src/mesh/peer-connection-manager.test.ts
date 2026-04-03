import { beforeEach, describe, expect, it, vi } from "vitest";
import { PeerConnectionManager, type PeerConnectionManagerDeps } from "./peer-connection-manager.js";
import { PeerRegistry } from "./peer-registry.js";
import { MeshCapabilityRegistry } from "./capabilities.js";
import { ContextPropagator } from "./context-propagator.js";
import { WorldModel } from "./world-model.js";
import { MeshEventBus } from "./event-bus.js";
import { AutoConnectManager } from "./auto-connect.js";
import type { DeviceIdentity } from "../infra/device-identity.js";
import type { PeerSession } from "./types.js";

vi.mock("./peer-client.js", () => {
  const instances: any[] = [];

  class MeshPeerClient {
    opts: any;

    constructor(opts: any) {
      this.opts = opts;
      instances.push(this);
    }

    start() {}
    stop() {}

    __simulateConnected(session?: any) {
      this.opts.onConnected?.(
        session ?? {
          deviceId: this.opts.remoteDeviceId,
          connId: `conn-${this.opts.remoteDeviceId}`,
          socket: { send: vi.fn() },
          outbound: true,
          capabilities: [],
          connectedAtMs: Date.now(),
        },
      );
    }

    __simulateDisconnected(deviceId?: string) {
      this.opts.onDisconnected?.(deviceId ?? this.opts.remoteDeviceId);
    }

    __emitEvent(event: string, payload: unknown) {
      this.opts.onEvent?.(event, payload);
    }
  }

  return {
    MeshPeerClient,
    __peerClientInstances: instances,
  };
});

import { __peerClientInstances } from "./peer-client.js";

const noop = { info: () => {}, warn: () => {} };

const fakeIdentity: DeviceIdentity = {
  deviceId: "mgr-test-device",
  publicKeyPem: "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----\n",
  privateKeyPem: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
};

function createDeps(): PeerConnectionManagerDeps {
  const peerRegistry = new PeerRegistry();
  return {
    identity: fakeIdentity,
    displayName: "test-manager",
    capabilities: ["channel:test"],
    peerRegistry,
    capabilityRegistry: new MeshCapabilityRegistry(),
    contextPropagator: new ContextPropagator({
      identity: fakeIdentity,
      peerRegistry,
      log: { info: () => {} },
    }),
    worldModel: new WorldModel({ log: { info: () => {} } }),
    eventBus: new MeshEventBus(),
    autoConnect: new AutoConnectManager(),
    log: noop,
  };
}

function makeSession(deviceId: string): PeerSession {
  return {
    deviceId,
    connId: `conn-${deviceId}`,
    displayName: deviceId,
    publicKey: undefined,
    socket: { send: vi.fn() } as any,
    outbound: true,
    capabilities: ["channel:test"],
    connectedAtMs: Date.now(),
  };
}

describe("PeerConnectionManager", () => {
  let manager: PeerConnectionManager;
  let deps: PeerConnectionManagerDeps;

  beforeEach(() => {
    __peerClientInstances.length = 0;
    deps = createDeps();
    manager = new PeerConnectionManager(deps);
  });

  it("starts empty", () => {
    expect(manager.size).toBe(0);
    expect(manager.has("any")).toBe(false);
  });

  it("connectToPeer registers a client", () => {
    manager.connectToPeer({
      deviceId: "peer-1",
      url: "ws://127.0.0.1:19999",
    });
    expect(manager.has("peer-1")).toBe(true);
    expect(manager.size).toBe(1);
    manager.stopAll(); // cleanup
  });

  it("connectToPeer is idempotent", () => {
    manager.connectToPeer({ deviceId: "peer-1", url: "ws://127.0.0.1:19999" });
    manager.connectToPeer({ deviceId: "peer-1", url: "ws://127.0.0.1:19999" });
    expect(manager.size).toBe(1);
    manager.stopAll();
  });

  it("can connect to multiple peers", () => {
    manager.connectToPeer({ deviceId: "peer-1", url: "ws://127.0.0.1:19999" });
    manager.connectToPeer({ deviceId: "peer-2", url: "ws://127.0.0.1:19998" });
    expect(manager.size).toBe(2);
    expect(manager.has("peer-1")).toBe(true);
    expect(manager.has("peer-2")).toBe(true);
    manager.stopAll();
  });

  it("stopAll clears all clients", () => {
    manager.connectToPeer({ deviceId: "peer-1", url: "ws://127.0.0.1:19999" });
    manager.connectToPeer({ deviceId: "peer-2", url: "ws://127.0.0.1:19998" });
    manager.stopAll();
    expect(manager.size).toBe(0);
    expect(manager.has("peer-1")).toBe(false);
  });

  it("stopAll is idempotent", () => {
    manager.connectToPeer({ deviceId: "peer-1", url: "ws://127.0.0.1:19999" });
    manager.stopAll();
    manager.stopAll(); // Should not throw
    expect(manager.size).toBe(0);
  });

  it("accepts TLS fingerprint in peer spec", () => {
    manager.connectToPeer({
      deviceId: "secure-peer",
      url: "wss://example.com:18789",
      tlsFingerprint: "sha256:AABBCCDD",
    });
    expect(manager.has("secure-peer")).toBe(true);
    manager.stopAll();
  });

  it("broadcasts peer.down when an unexpected disconnect is detected", () => {
    const broadcastSpy = vi.spyOn(deps.peerRegistry, "broadcastEvent");

    manager.connectToPeer({ deviceId: "peer-1", url: "ws://127.0.0.1:19999" });
    const client = __peerClientInstances[0];
    client.__simulateConnected(makeSession("peer-1"));

    client.__simulateDisconnected("peer-1");

    expect(broadcastSpy).toHaveBeenCalledWith(
      "peer.down",
      expect.objectContaining({ deviceId: "peer-1" }),
    );
  });

  it("removes the target peer when another node reports peer.down", () => {
    const disconnected: Array<{ deviceId: string; reason?: string }> = [];
    deps.eventBus.on("peer.disconnected", (event) => disconnected.push(event));

    manager.connectToPeer({ deviceId: "reporter", url: "ws://127.0.0.1:19999" });
    const reporterClient = __peerClientInstances[0];

    deps.peerRegistry.register(makeSession("reporter"));
    deps.peerRegistry.register(makeSession("dead-peer"));

    expect(deps.peerRegistry.get("dead-peer")).toBeDefined();

    reporterClient.__emitEvent("peer.down", { deviceId: "dead-peer" });

    expect(deps.peerRegistry.get("dead-peer")).toBeUndefined();
    expect(disconnected).toContainEqual({ deviceId: "dead-peer", reason: "peer down" });
  });
});
