import { describe, it, expect, vi } from "vitest";
import {
  createConnectionTracker,
  handleInboundDisconnect,
} from "./inbound-connection.js";
import { PeerRegistry } from "./peer-registry.js";
import { MeshCapabilityRegistry } from "./capabilities.js";
import { MeshEventBus } from "./event-bus.js";

// ─── createConnectionTracker ────────────────────────

describe("createConnectionTracker", () => {
  it("starts empty", () => {
    const tracker = createConnectionTracker();
    expect(tracker.size).toBe(0);
  });

  it("add increases size", () => {
    const tracker = createConnectionTracker();
    tracker.add({} as any, "conn-1");
    expect(tracker.size).toBe(1);
  });

  it("add multiple connections", () => {
    const tracker = createConnectionTracker();
    tracker.add({} as any, "conn-1");
    tracker.add({} as any, "conn-2");
    expect(tracker.size).toBe(2);
  });

  it("remove decreases size", () => {
    const tracker = createConnectionTracker();
    const sock = {} as any;
    tracker.add(sock, "conn-1");
    tracker.remove(sock);
    expect(tracker.size).toBe(0);
  });

  it("remove unknown socket is no-op", () => {
    const tracker = createConnectionTracker();
    tracker.remove({} as any);
    expect(tracker.size).toBe(0);
  });

  it("closeAll calls close on all sockets", () => {
    const tracker = createConnectionTracker();
    const s1 = { close: vi.fn() } as any;
    const s2 = { close: vi.fn() } as any;
    tracker.add(s1, "c1");
    tracker.add(s2, "c2");
    tracker.closeAll();
    expect(s1.close).toHaveBeenCalled();
    expect(s2.close).toHaveBeenCalled();
    expect(tracker.size).toBe(0);
  });

  it("closeAll ignores close errors", () => {
    const tracker = createConnectionTracker();
    const s = { close: vi.fn().mockImplementation(() => { throw new Error("oops"); }) } as any;
    tracker.add(s, "c1");
    expect(() => tracker.closeAll()).not.toThrow();
    expect(tracker.size).toBe(0);
  });

  it("closeAll on empty is no-op", () => {
    const tracker = createConnectionTracker();
    expect(() => tracker.closeAll()).not.toThrow();
  });
});

// ─── handleInboundDisconnect ────────────────────────

describe("handleInboundDisconnect", () => {
  function makeDeps() {
    return {
      peerRegistry: new PeerRegistry(),
      capabilityRegistry: new MeshCapabilityRegistry(),
      eventBus: new MeshEventBus(),
      log: { info: vi.fn(), warn: vi.fn() },
    };
  }

  it("returns null for unknown connId", () => {
    const deps = makeDeps();
    const result = handleInboundDisconnect("unknown", deps);
    expect(result).toBeNull();
  });

  it("unregisters peer and returns deviceId", () => {
    const deps = makeDeps();
    const socket = { send: vi.fn(), addEventListener: vi.fn() } as any;
    deps.peerRegistry.register({
      connectedAtMs: Date.now(),
      deviceId: "device-12345678",
      connId: "conn-1",
      socket,
      displayName: "Test",
      outbound: false,
      capabilities: ["sensor:moisture"],
    });
    deps.capabilityRegistry.updatePeer("device-12345678", ["sensor:moisture"]);

    const result = handleInboundDisconnect("conn-1", deps);
    expect(result).toBe("device-12345678");
  });

  it("removes capabilities on disconnect", () => {
    const deps = makeDeps();
    const socket = { send: vi.fn(), addEventListener: vi.fn() } as any;
    deps.peerRegistry.register({
      connectedAtMs: Date.now(),
      deviceId: "dev-1",
      connId: "conn-1",
      socket,
      displayName: "Test",
      outbound: false,
      capabilities: ["sensor:moisture"],
    });
    deps.capabilityRegistry.updatePeer("dev-1", ["sensor:moisture"]);

    handleInboundDisconnect("conn-1", deps);
    expect(deps.capabilityRegistry.getPeerCapabilities("dev-1")).toEqual([]);
  });

  it("emits peer.disconnected event", () => {
    const deps = makeDeps();
    const events: any[] = [];
    deps.eventBus.on("peer.disconnected", (e) => events.push(e));
    const socket = { send: vi.fn(), addEventListener: vi.fn() } as any;
    deps.peerRegistry.register({
      connectedAtMs: Date.now(),
      deviceId: "dev-1",
      connId: "conn-1",
      socket,
      displayName: "Test",
      outbound: false,
      capabilities: [],
    });

    handleInboundDisconnect("conn-1", deps);
    expect(events).toHaveLength(1);
    expect(events[0].deviceId).toBe("dev-1");
    expect(events[0].reason).toBe("socket closed");
  });

  it("logs disconnection", () => {
    const deps = makeDeps();
    const socket = { send: vi.fn(), addEventListener: vi.fn() } as any;
    deps.peerRegistry.register({
      connectedAtMs: Date.now(),
      deviceId: "device-abcdef123456",
      connId: "conn-1",
      socket,
      displayName: "Test",
      outbound: false,
      capabilities: [],
    });

    handleInboundDisconnect("conn-1", deps);
    expect(deps.log.info).toHaveBeenCalledWith(expect.stringContaining("device-abcde"));
  });
});
