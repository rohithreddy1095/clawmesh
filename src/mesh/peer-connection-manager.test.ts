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

const peerClientInstances: any[] = [];

vi.mock("./peer-client.js", () => {
  class MeshPeerClient {
    opts: any;

    constructor(opts: any) {
      this.opts = opts;
      peerClientInstances.push(this);
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

    async __emitEvent(event: string, payload: unknown) {
      await this.opts.onEvent?.(event, payload);
    }
  }

  return {
    MeshPeerClient,
  };
});

const noop = { info: () => {}, warn: () => {} };

const fakeIdentity: DeviceIdentity = {
  deviceId: "mgr-test-device",
  publicKeyPem: "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----\n",
  privateKeyPem: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
};

function createDeps(overrides: Partial<PeerConnectionManagerDeps> = {}): PeerConnectionManagerDeps {
  const peerRegistry = overrides.peerRegistry ?? new PeerRegistry();
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
    ...overrides,
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
    peerClientInstances.length = 0;
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

  it("refuses insecure ws connections for relay-labeled peers", () => {
    const warn = vi.fn();
    deps = createDeps({ log: { info: vi.fn(), warn } });
    manager = new PeerConnectionManager(deps);

    manager.connectToPeer({
      deviceId: "relay-peer",
      url: "ws://relay.example.com/mesh",
      transportLabel: "relay",
    });

    expect(manager.has("relay-peer")).toBe(false);
    expect(peerClientInstances).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("refusing insecure relay connection"),
    );
  });

  it("normalizes https relay URLs before creating the client", () => {
    manager.connectToPeer({
      deviceId: "secure-peer",
      url: "https://relay.example.com/mesh",
      tlsFingerprint: "sha256:AABBCCDD",
      transportLabel: "relay",
    });
    expect(peerClientInstances[0]?.opts.url).toBe("wss://relay.example.com/mesh");
    expect(peerClientInstances[0]?.opts.transportLabel).toBe("relay");
    manager.stopAll();
  });

  it("logs outbound connect attempts with transport posture context", () => {
    const info = vi.fn();
    deps = createDeps({ log: { info, warn: vi.fn() } });
    manager = new PeerConnectionManager(deps);

    manager.connectToPeer({
      deviceId: "secure-peer",
      url: "https://relay.example.com/mesh",
      tlsFingerprint: "sha256:AABBCCDD",
      transportLabel: "relay",
    });

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("wss://relay.example.com/mesh via relay (tls-pinned)"),
    );
    manager.stopAll();
  });

  it("logs outbound peer errors with transport posture context", () => {
    const warn = vi.fn();
    deps = createDeps({ log: { info: vi.fn(), warn } });
    manager = new PeerConnectionManager(deps);

    manager.connectToPeer({
      deviceId: "secure-peer",
      url: "https://relay.example.com/mesh",
      tlsFingerprint: "sha256:AABBCCDD",
      transportLabel: "relay",
    });

    peerClientInstances[0]?.opts.onError?.(new Error("boom"));

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("wss://relay.example.com/mesh via relay (tls-pinned)"),
    );
    manager.stopAll();
  });

  it("broadcasts peer.down when an unexpected disconnect is detected", () => {
    const broadcastSpy = vi.spyOn(deps.peerRegistry, "broadcastEvent");

    manager.connectToPeer({ deviceId: "peer-1", url: "ws://127.0.0.1:19999" });
    const client = peerClientInstances[0];
    client.__simulateConnected(makeSession("peer-1"));

    client.__simulateDisconnected("peer-1");

    expect(broadcastSpy).toHaveBeenCalledWith(
      "peer.down",
      expect.objectContaining({ deviceId: "peer-1" }),
    );
  });

  it("removes the target peer when another node reports peer.down", async () => {
    const disconnected: Array<{ deviceId: string; reason?: string }> = [];
    deps.eventBus.on("peer.disconnected", (event) => disconnected.push(event));

    manager.connectToPeer({ deviceId: "reporter", url: "ws://127.0.0.1:19999" });
    const reporterClient = peerClientInstances[0];

    deps.peerRegistry.register(makeSession("reporter"));
    deps.peerRegistry.register(makeSession("dead-peer"));

    expect(deps.peerRegistry.get("dead-peer")).toBeDefined();

    await reporterClient.__emitEvent("peer.down", { deviceId: "dead-peer" });

    expect(deps.peerRegistry.get("dead-peer")).toBeUndefined();
    expect(disconnected).toContainEqual({ deviceId: "dead-peer", reason: "peer down" });
  });

  it("ignores peer.down when the reported peer is still reachable", async () => {
    const disconnected: Array<{ deviceId: string; reason?: string }> = [];
    const confirmPeerReachable = vi.fn(async (deviceId: string) => deviceId === "healthy-peer");

    deps = createDeps({ confirmPeerReachable });
    manager = new PeerConnectionManager(deps);
    deps.eventBus.on("peer.disconnected", (event) => disconnected.push(event));

    manager.connectToPeer({ deviceId: "reporter", url: "ws://127.0.0.1:19999" });
    const reporterClient = peerClientInstances[0];

    deps.peerRegistry.register(makeSession("reporter"));
    deps.peerRegistry.register(makeSession("healthy-peer"));

    await reporterClient.__emitEvent("peer.down", { deviceId: "healthy-peer" });

    expect(confirmPeerReachable).toHaveBeenCalledWith("healthy-peer");
    expect(deps.peerRegistry.get("healthy-peer")).toBeDefined();
    expect(disconnected).toHaveLength(0);
  });

  it("ignores peer.down events with unsupported generation", async () => {
    deps.peerRegistry.register(makeSession("reporter"));
    deps.peerRegistry.register(makeSession("healthy-peer"));

    manager.connectToPeer({ deviceId: "reporter", url: "ws://127.0.0.1:19999" });
    const reporterClient = peerClientInstances[0];

    await reporterClient.__emitEvent("peer.down", { deviceId: "healthy-peer", gen: 99 });

    expect(deps.peerRegistry.get("healthy-peer")).toBeDefined();
  });
});
