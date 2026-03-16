/**
 * Tests for RpcDispatcher wiring into MeshNodeRuntime.
 *
 * Verifies that the RpcDispatcher correctly replaced the inline
 * dispatchRpcRequest method and all handlers are properly registered.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MeshNodeRuntime } from "./node-runtime.js";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "rpc-wiring-test-"));
}

describe("RpcDispatcher wiring in MeshNodeRuntime", () => {
  let tmpDir: string;
  let runtime: MeshNodeRuntime;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const identity = loadOrCreateDeviceIdentity(join(tmpDir, "device.json"));
    runtime = new MeshNodeRuntime({
      identity,
      port: 0, // Random port
      displayName: "test-node",
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
  });

  afterEach(async () => {
    await runtime.stop();
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it("exposes rpcDispatcher as a public property", () => {
    expect(runtime.rpcDispatcher).toBeDefined();
    expect(typeof runtime.rpcDispatcher.dispatch).toBe("function");
  });

  it("registers mesh.connect handler", () => {
    expect(runtime.rpcDispatcher.hasHandler("mesh.connect")).toBe(true);
  });

  it("registers mesh.peers handler", () => {
    expect(runtime.rpcDispatcher.hasHandler("mesh.peers")).toBe(true);
  });

  it("registers mesh.status handler", () => {
    expect(runtime.rpcDispatcher.hasHandler("mesh.status")).toBe(true);
  });

  it("registers mesh.message.forward handler", () => {
    expect(runtime.rpcDispatcher.hasHandler("mesh.message.forward")).toBe(true);
  });

  it("registers chat.subscribe handler", () => {
    expect(runtime.rpcDispatcher.hasHandler("chat.subscribe")).toBe(true);
  });

  it("registers chat.proposal.approve handler", () => {
    expect(runtime.rpcDispatcher.hasHandler("chat.proposal.approve")).toBe(true);
  });

  it("registers chat.proposal.reject handler", () => {
    expect(runtime.rpcDispatcher.hasHandler("chat.proposal.reject")).toBe(true);
  });

  it("registers context.sync handler", () => {
    expect(runtime.rpcDispatcher.hasHandler("context.sync")).toBe(true);
  });

  it("registers mesh.health handler", () => {
    expect(runtime.rpcDispatcher.hasHandler("mesh.health")).toBe(true);
  });

  it("lists all registered methods", () => {
    const methods = runtime.rpcDispatcher.listMethods();
    expect(methods.length).toBeGreaterThanOrEqual(7);
    expect(methods).toContain("mesh.connect");
    expect(methods).toContain("mesh.peers");
    expect(methods).toContain("context.sync");
    expect(methods).toContain("mesh.health");
  });

  it("exposes eventBus as a public property", () => {
    expect(runtime.eventBus).toBeDefined();
    expect(typeof runtime.eventBus.on).toBe("function");
    expect(typeof runtime.eventBus.emit).toBe("function");
  });
});

describe("UIBroadcaster wiring in MeshNodeRuntime", () => {
  let tmpDir: string;
  let runtime: MeshNodeRuntime;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const identity = loadOrCreateDeviceIdentity(join(tmpDir, "device.json"));
    runtime = new MeshNodeRuntime({
      identity,
      port: 0,
      displayName: "test-node",
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
  });

  afterEach(async () => {
    await runtime.stop();
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it("exposes uiBroadcaster as a public property", () => {
    expect(runtime.uiBroadcaster).toBeDefined();
    expect(typeof runtime.uiBroadcaster.broadcast).toBe("function");
  });

  it("broadcastToUI delegates to uiBroadcaster", () => {
    // broadcastToUI should not throw even with no subscribers
    expect(() => {
      runtime.broadcastToUI("test.event", { data: "hello" });
    }).not.toThrow();
  });

  it("starts with zero UI subscribers", () => {
    expect(runtime.uiBroadcaster.subscriberCount).toBe(0);
  });
});

describe("MessageRouter wiring in MeshNodeRuntime", () => {
  let tmpDir: string;
  let runtime: MeshNodeRuntime;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const identity = loadOrCreateDeviceIdentity(join(tmpDir, "device.json"));
    runtime = new MeshNodeRuntime({
      identity,
      port: 0,
      displayName: "test-node",
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
  });

  afterEach(async () => {
    await runtime.stop();
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it("node-runtime god object is under 600 lines", () => {
    // This test documents and enforces the decomposition progress
    const fs = require("node:fs");
    const lines = fs.readFileSync("src/mesh/node-runtime.ts", "utf-8").split("\n").length;
    expect(lines).toBeLessThan(600);
  });

  it("has all critical RPC handlers after message router wiring", () => {
    const methods = runtime.rpcDispatcher.listMethods();
    expect(methods).toContain("mesh.connect");
    expect(methods).toContain("mesh.message.forward");
    expect(methods).toContain("context.sync");
    expect(methods).toContain("mesh.health");
  });
});

describe("Context sync wiring in MeshNodeRuntime", () => {
  let tmpDir: string;
  let runtime: MeshNodeRuntime;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const identity = loadOrCreateDeviceIdentity(join(tmpDir, "device.json"));
    runtime = new MeshNodeRuntime({
      identity,
      port: 0,
      displayName: "test-node",
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
  });

  afterEach(async () => {
    await runtime.stop();
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it("has context.sync RPC handler registered", () => {
    expect(runtime.rpcDispatcher.hasHandler("context.sync")).toBe(true);
  });

  it("world model is accessible for sync operations", () => {
    expect(runtime.worldModel).toBeDefined();
    expect(typeof runtime.worldModel.ingest).toBe("function");
    expect(typeof runtime.worldModel.getRecentFrames).toBe("function");
  });
});

describe("TrustAudit wiring in MeshNodeRuntime", () => {
  let tmpDir: string;
  let runtime: MeshNodeRuntime;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const identity = loadOrCreateDeviceIdentity(join(tmpDir, "device.json"));
    runtime = new MeshNodeRuntime({
      identity,
      port: 0,
      displayName: "test-node",
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
  });

  afterEach(async () => {
    await runtime.stop();
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it("exposes trustAudit as a public property", () => {
    expect(runtime.trustAudit).toBeDefined();
    expect(typeof runtime.trustAudit.record).toBe("function");
    expect(typeof runtime.trustAudit.getStats).toBe("function");
  });

  it("trustAudit starts empty", () => {
    expect(runtime.trustAudit.size).toBe(0);
    const stats = runtime.trustAudit.getStats();
    expect(stats.total).toBe(0);
  });
});

describe("AutoConnect wiring in MeshNodeRuntime", () => {
  let tmpDir: string;
  let runtime: MeshNodeRuntime;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const identity = loadOrCreateDeviceIdentity(join(tmpDir, "device.json"));
    runtime = new MeshNodeRuntime({
      identity,
      port: 0,
      displayName: "test-node",
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
  });

  afterEach(async () => {
    await runtime.stop();
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it("exposes autoConnect as a public property", () => {
    expect(runtime.autoConnect).toBeDefined();
    expect(typeof runtime.autoConnect.evaluate).toBe("function");
  });

  it("autoConnect starts with no attempts", () => {
    expect(runtime.autoConnect.getAttemptCount("any-peer")).toBe(0);
  });
});

describe("MeshNodeRuntime with mock actuator", () => {
  let tmpDir: string;
  let runtime: MeshNodeRuntime;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const identity = loadOrCreateDeviceIdentity(join(tmpDir, "device.json"));
    runtime = new MeshNodeRuntime({
      identity,
      port: 0,
      displayName: "actuator-node",
      enableMockActuator: true,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
  });

  afterEach(async () => {
    await runtime.stop();
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it("registers actuator state handler when mock actuator enabled", () => {
    expect(runtime.rpcDispatcher.hasHandler("clawmesh.mock.actuator.state")).toBe(true);
  });

  it("has more methods than a basic node", () => {
    const methods = runtime.rpcDispatcher.listMethods();
    expect(methods).toContain("clawmesh.mock.actuator.state");
    expect(methods.length).toBeGreaterThanOrEqual(8);
  });
});
