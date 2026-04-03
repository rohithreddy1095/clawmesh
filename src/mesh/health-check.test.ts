import { describe, it, expect, beforeEach } from "vitest";
import {
  computeHealthCheck,
  createHealthCheckHandlers,
  type HealthCheckDeps,
} from "./health-check.js";
import { PeerRegistry } from "./peer-registry.js";
import { MeshCapabilityRegistry } from "./capabilities.js";
import { WorldModel } from "./world-model.js";

const noop = { info: () => {} };

function createDeps(overrides?: Partial<HealthCheckDeps>): HealthCheckDeps {
  return {
    nodeId: "abcdef1234567890abcdef1234567890",
    displayName: "test-node",
    startedAtMs: Date.now() - 60_000, // 1 minute ago
    version: "0.2.0",
    localCapabilities: ["channel:clawmesh", "actuator:mock"],
    peerRegistry: new PeerRegistry(),
    capabilityRegistry: new MeshCapabilityRegistry(),
    worldModel: new WorldModel({ log: noop }),
    ...overrides,
  };
}

describe("computeHealthCheck", () => {
  it("returns healthy status for basic node", () => {
    const deps = createDeps();
    const result = computeHealthCheck(deps);

    expect(result.status).toBe("healthy");
    expect(result.displayName).toBe("test-node");
    expect(result.version).toBe("0.2.0");
    expect(result.uptimeMs).toBeGreaterThan(50_000);
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("truncates nodeId for security", () => {
    const deps = createDeps();
    const result = computeHealthCheck(deps);
    expect(result.nodeId).toContain("...");
    expect(result.nodeId.length).toBeLessThan(30);
  });

  it("reports peer count", () => {
    const deps = createDeps();
    const peerRegistry = deps.peerRegistry;

    // Register a mock peer
    peerRegistry.register({
      deviceId: "peer-1-device-id",
      connId: "conn-1",
      socket: null as any,
      outbound: true,
      capabilities: ["channel:telegram"],
      role: "viewer",
      transportLabel: "relay",
      connectedAtMs: Date.now() - 30_000,
    });

    const result = computeHealthCheck(deps);
    expect(result.peers.connected).toBe(1);
    expect(result.peers.details).toHaveLength(1);
    expect(result.peers.details[0].outbound).toBe(true);
    expect(result.peers.details[0].role).toBe("viewer");
    expect(result.peers.details[0].transportLabel).toBe("relay");
    expect(result.peers.details[0].connectedMs).toBeGreaterThan(20_000);
  });

  it("reports world model stats", () => {
    const deps = createDeps();
    deps.worldModel.ingest({
      kind: "observation",
      frameId: "f1",
      sourceDeviceId: "dev",
      timestamp: Date.now(),
      data: { metric: "moisture", value: 25, zone: "z1" },
      trust: {
        evidence_sources: ["sensor"],
        evidence_trust_tier: "T2_operational_observation",
      },
    });
    deps.worldModel.ingest({
      kind: "event",
      frameId: "f2",
      sourceDeviceId: "dev",
      timestamp: Date.now(),
      data: { event: "pump_started" },
      trust: {
        evidence_sources: ["sensor"],
        evidence_trust_tier: "T3_verified_action_evidence",
      },
    });

    const result = computeHealthCheck(deps);
    expect(result.worldModel.entries).toBe(2);
    expect(result.worldModel.frameLogSize).toBe(2);
  });

  it("reports local capabilities", () => {
    const deps = createDeps();
    const result = computeHealthCheck(deps);
    expect(result.capabilities.local).toContain("channel:clawmesh");
    expect(result.capabilities.local).toContain("actuator:mock");
  });

  it("reports mesh capability count", () => {
    const deps = createDeps();
    deps.capabilityRegistry.updatePeer("peer-1", ["channel:telegram", "skill:weather"]);
    deps.capabilityRegistry.updatePeer("peer-2", ["actuator:pump"]);

    const result = computeHealthCheck(deps);
    expect(result.capabilities.meshTotal).toBe(3);
  });

  it("reports degraded when no peers and no capabilities", () => {
    const deps = createDeps({ localCapabilities: [] });
    const result = computeHealthCheck(deps);
    expect(result.status).toBe("degraded");
  });

  it("reports degraded when planner is suspended", () => {
    const deps = createDeps({
      getPlannerMode: () => "suspended",
    });
    const result = computeHealthCheck(deps);
    expect(result.status).toBe("degraded");
    expect(result.plannerMode).toBe("suspended");
  });

  it("reports healthy when planner is active", () => {
    const deps = createDeps({
      getPlannerMode: () => "active",
    });
    const result = computeHealthCheck(deps);
    expect(result.status).toBe("healthy");
    expect(result.plannerMode).toBe("active");
  });

  it("reports planner leader when provided", () => {
    const deps = createDeps({
      getPlannerLeader: () => ({ kind: "local", deviceId: "local-device", role: "planner" }),
    });
    const result = computeHealthCheck(deps);
    expect(result.plannerLeader).toEqual({ kind: "local", deviceId: "local-device", role: "planner" });
  });

  it("reports planner activity when provided", () => {
    const deps = createDeps({
      getPlannerActivity: () => ({
        state: "standby",
        shouldHandleAutonomous: false,
        role: "standby-planner",
        leader: { kind: "peer", deviceId: "planner-1", role: "planner" },
      }),
    });
    const result = computeHealthCheck(deps);
    expect(result.plannerActivity).toEqual({
      state: "standby",
      shouldHandleAutonomous: false,
      role: "standby-planner",
      leader: { kind: "peer", deviceId: "planner-1", role: "planner" },
    });
  });

  it("reports whether discovery is enabled", () => {
    const deps = createDeps({
      isDiscoveryEnabled: () => false,
    } as any);
    const result = computeHealthCheck(deps as any);
    expect(result.discoveryEnabled).toBe(false);
  });

  it("includes memory usage", () => {
    const deps = createDeps();
    const result = computeHealthCheck(deps);
    expect(result.memoryUsageMB).toBeGreaterThan(0);
  });

  it("reports correct uptime", () => {
    const deps = createDeps({ startedAtMs: Date.now() - 120_000 });
    const result = computeHealthCheck(deps);
    expect(result.uptimeMs).toBeGreaterThanOrEqual(110_000);
    expect(result.uptimeMs).toBeLessThanOrEqual(130_000);
  });
});

describe("createHealthCheckHandlers", () => {
  it("creates a mesh.health handler", () => {
    const deps = createDeps();
    const handlers = createHealthCheckHandlers(deps);
    expect(handlers["mesh.health"]).toBeDefined();
    expect(typeof handlers["mesh.health"]).toBe("function");
  });

  it("mesh.health handler responds with health data", async () => {
    const deps = createDeps();
    const handlers = createHealthCheckHandlers(deps);

    let responded = false;
    let responsePayload: unknown;

    await handlers["mesh.health"]({
      req: {},
      params: {},
      respond: (ok, payload) => {
        responded = true;
        expect(ok).toBe(true);
        responsePayload = payload;
      },
    });

    expect(responded).toBe(true);
    const result = responsePayload as any;
    expect(result.status).toBe("healthy");
    expect(result.version).toBe("0.2.0");
  });
});
