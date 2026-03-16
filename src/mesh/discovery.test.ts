import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MeshDiscovery } from "./discovery.js";

// Mock the ciao library to avoid real mDNS traffic in tests
let browserCallbacks: Record<string, Function[]> = {};
vi.mock("@homebridge/ciao", () => {
  const browser = {
    on: vi.fn((event: string, cb: Function) => {
      if (!browserCallbacks[event]) browserCallbacks[event] = [];
      browserCallbacks[event].push(cb);
    }),
    start: vi.fn(),
  };
  const service = {
    advertise: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
  };
  const responder = {
    createService: vi.fn(() => service),
    createServiceBrowser: vi.fn(() => browser),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
  return {
    default: {
      getResponder: vi.fn(() => responder),
    },
  };
});

describe("MeshDiscovery", () => {
  let discovery: MeshDiscovery;

  beforeEach(() => {
    browserCallbacks = {};
    discovery = new MeshDiscovery({
      localDeviceId: "local-device-abc",
      localPort: 18789,
      displayName: "test-node",
    });
  });

  afterEach(() => {
    discovery.stop();
  });

  it("creates a discovery instance", () => {
    expect(discovery).toBeDefined();
  });

  it("starts without errors", () => {
    expect(() => discovery.start()).not.toThrow();
  });

  it("start() is idempotent", () => {
    discovery.start();
    discovery.start(); // Should not create a second responder
  });

  it("stop() after start() does not throw", () => {
    discovery.start();
    expect(() => discovery.stop()).not.toThrow();
  });

  it("stop() without start() does not throw", () => {
    expect(() => discovery.stop()).not.toThrow();
  });

  it("listPeers returns empty initially", () => {
    expect(discovery.listPeers()).toEqual([]);
  });

  it("emits peer-discovered when mDNS finds a new peer", () => {
    discovery.start();

    const discovered: any[] = [];
    discovery.on("peer-discovered", (peer) => discovered.push(peer));

    // Simulate mDNS "up" event
    const upCallbacks = browserCallbacks["up"] ?? [];
    for (const cb of upCallbacks) {
      cb({
        name: "remote-node",
        txt: { deviceId: "remote-device-xyz" },
        addresses: ["192.168.1.39"],
        port: 18789,
      });
    }

    expect(discovered).toHaveLength(1);
    expect(discovered[0].deviceId).toBe("remote-device-xyz");
    expect(discovered[0].host).toBe("192.168.1.39");
    expect(discovered[0].port).toBe(18789);
  });

  it("ignores own device in peer discovery", () => {
    discovery.start();

    const discovered: any[] = [];
    discovery.on("peer-discovered", (peer) => discovered.push(peer));

    // Simulate discovering ourselves
    const upCallbacks = browserCallbacks["up"] ?? [];
    for (const cb of upCallbacks) {
      cb({
        name: "self",
        txt: { deviceId: "local-device-abc" }, // Same as localDeviceId
        addresses: ["127.0.0.1"],
        port: 18789,
      });
    }

    expect(discovered).toHaveLength(0);
  });

  it("deduplicates already-known peers", () => {
    discovery.start();

    const discovered: any[] = [];
    discovery.on("peer-discovered", (peer) => discovered.push(peer));

    const upCallbacks = browserCallbacks["up"] ?? [];
    // First discovery
    for (const cb of upCallbacks) {
      cb({
        name: "node",
        txt: { deviceId: "peer-dup" },
        addresses: ["10.0.0.1"],
        port: 18789,
      });
    }
    // Second discovery (same deviceId)
    for (const cb of upCallbacks) {
      cb({
        name: "node",
        txt: { deviceId: "peer-dup" },
        addresses: ["10.0.0.1"],
        port: 18789,
      });
    }

    expect(discovered).toHaveLength(1); // Only emitted once
  });

  it("emits peer-lost when mDNS loses a peer", () => {
    discovery.start();

    // First discover the peer
    const upCallbacks = browserCallbacks["up"] ?? [];
    for (const cb of upCallbacks) {
      cb({ name: "node", txt: { deviceId: "lost-peer" }, addresses: ["10.0.0.1"], port: 18789 });
    }

    const lost: string[] = [];
    discovery.on("peer-lost", (deviceId) => lost.push(deviceId));

    // Simulate "down" event
    const downCallbacks = browserCallbacks["down"] ?? [];
    for (const cb of downCallbacks) {
      cb({ name: "node", txt: { deviceId: "lost-peer" } });
    }

    expect(lost).toHaveLength(1);
    expect(lost[0]).toBe("lost-peer");
  });

  it("listPeers returns discovered peers", () => {
    discovery.start();

    const upCallbacks = browserCallbacks["up"] ?? [];
    for (const cb of upCallbacks) {
      cb({ name: "node-1", txt: { deviceId: "peer-1" }, addresses: ["10.0.0.1"], port: 18789 });
    }
    for (const cb of upCallbacks) {
      cb({ name: "node-2", txt: { deviceId: "peer-2" }, addresses: ["10.0.0.2"], port: 18790 });
    }

    const peers = discovery.listPeers();
    expect(peers).toHaveLength(2);
    expect(peers.map((p) => p.deviceId)).toContain("peer-1");
    expect(peers.map((p) => p.deviceId)).toContain("peer-2");
  });

  it("ignores services without deviceId in txt", () => {
    discovery.start();

    const discovered: any[] = [];
    discovery.on("peer-discovered", (peer) => discovered.push(peer));

    const upCallbacks = browserCallbacks["up"] ?? [];
    for (const cb of upCallbacks) {
      cb({ name: "unknown", txt: {}, addresses: ["10.0.0.1"], port: 18789 });
    }

    expect(discovered).toHaveLength(0);
  });
});
