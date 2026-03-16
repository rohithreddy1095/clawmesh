import { describe, it, expect, beforeEach } from "vitest";
import { PeerConnectionManager, type PeerConnectionManagerDeps } from "./peer-connection-manager.js";
import { PeerRegistry } from "./peer-registry.js";
import { MeshCapabilityRegistry } from "./capabilities.js";
import { ContextPropagator } from "./context-propagator.js";
import { WorldModel } from "./world-model.js";
import { MeshEventBus } from "./event-bus.js";
import { AutoConnectManager } from "./auto-connect.js";
import type { DeviceIdentity } from "../infra/device-identity.js";

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

describe("PeerConnectionManager", () => {
  let manager: PeerConnectionManager;

  beforeEach(() => {
    manager = new PeerConnectionManager(createDeps());
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
});
