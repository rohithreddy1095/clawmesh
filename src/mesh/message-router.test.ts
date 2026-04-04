import { describe, it, expect, vi, beforeEach } from "vitest";
import { routeInboundMessage, type MessageRouterDeps } from "./message-router.js";
import { PeerRegistry } from "./peer-registry.js";
import { ContextPropagator } from "./context-propagator.js";
import { WorldModel } from "./world-model.js";
import { MeshEventBus } from "./event-bus.js";
import { RpcDispatcher } from "./rpc-dispatcher.js";
import type { DeviceIdentity } from "../infra/device-identity.js";
import type { ContextFrame } from "./context-types.js";

const noop = { info: () => {} };
const noopLog = { info: () => {}, warn: () => {}, error: () => {} };

const fakeIdentity: DeviceIdentity = {
  deviceId: "test-device",
  publicKeyPem: "fake",
  privateKeyPem: "fake",
};

function createDeps(): MessageRouterDeps {
  const peerRegistry = new PeerRegistry();
  const contextPropagator = new ContextPropagator({
    identity: fakeIdentity,
    peerRegistry,
    log: noop,
  });
  const worldModel = new WorldModel({ log: noop });
  const eventBus = new MeshEventBus();
  const rpcDispatcher = new RpcDispatcher();

  return {
    peerRegistry,
    contextPropagator,
    worldModel,
    eventBus,
    rpcDispatcher,
    intentRouterDeps: {
      deviceId: "test-device",
      displayName: "test-node",
      contextPropagator,
      broadcastToUI: () => {},
      log: noopLog,
    },
  };
}

const WS_OPEN = 1;
function mockSocket(): any {
  return { readyState: WS_OPEN, send: vi.fn() };
}

describe("routeInboundMessage", () => {
  let deps: MessageRouterDeps;

  beforeEach(() => {
    deps = createDeps();
  });

  // ─── JSON parsing ──────────────────────────

  it("rejects invalid JSON", async () => {
    const result = await routeInboundMessage("not json", mockSocket(), "c1", deps);
    expect(result.handled).toBe(false);
    if (!result.handled) expect(result.reason).toBe("invalid_json");
  });

  it("rejects non-object JSON", async () => {
    const result = await routeInboundMessage("42", mockSocket(), "c1", deps);
    expect(result.handled).toBe(false);
    if (!result.handled) expect(result.reason).toBe("not_object");
  });

  it("rejects null JSON", async () => {
    const result = await routeInboundMessage("null", mockSocket(), "c1", deps);
    expect(result.handled).toBe(false);
  });

  // ─── Context frame events ─────────────────

  it("routes context.frame events to propagator + world model", async () => {
    const frame: ContextFrame = {
      kind: "observation",
      frameId: "f-123",
      sourceDeviceId: "remote-device",
      timestamp: Date.now(),
      data: { metric: "moisture", value: 25, zone: "z1" },
      trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
      hops: 0,
    };

    const msg = JSON.stringify({ type: "event", event: "context.frame", payload: frame });
    const result = await routeInboundMessage(msg, mockSocket(), "c1", deps);

    expect(result).toEqual({ handled: true, kind: "context_frame" });
    expect(deps.worldModel.size).toBe(1);
  });

  it("emits event bus event on new context frame", async () => {
    const received: ContextFrame[] = [];
    deps.eventBus.on("context.frame.ingested", ({ frame }) => received.push(frame));

    const frame: ContextFrame = {
      kind: "observation",
      frameId: "f-456",
      sourceDeviceId: "remote-device",
      timestamp: Date.now(),
      data: { metric: "temp", value: 30, zone: "z2" },
      trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    };

    await routeInboundMessage(
      JSON.stringify({ type: "event", event: "context.frame", payload: frame }),
      mockSocket(), "c1", deps,
    );

    expect(received).toHaveLength(1);
    expect(received[0].frameId).toBe("f-456");
  });

  it("rejects context frames with unsupported generation", async () => {
    const frame: ContextFrame = {
      gen: 99,
      kind: "observation",
      frameId: "f-bad-gen",
      sourceDeviceId: "remote-device",
      timestamp: Date.now(),
      data: { metric: "moisture", value: 25, zone: "z1" },
      trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    };

    const msg = JSON.stringify({ type: "event", event: "context.frame", payload: frame });
    const result = await routeInboundMessage(msg, mockSocket(), "c1", deps);

    expect(result.handled).toBe(false);
    if (!result.handled) expect(result.reason).toBe("bad_generation");
    expect(deps.worldModel.size).toBe(0);
  });

  it("deduplicates context frames", async () => {
    const frame: ContextFrame = {
      kind: "observation",
      frameId: "dup-frame",
      sourceDeviceId: "remote",
      timestamp: Date.now(),
      data: { metric: "m", value: 1, zone: "z" },
      trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    };
    const msg = JSON.stringify({ type: "event", event: "context.frame", payload: frame });

    await routeInboundMessage(msg, mockSocket(), "c1", deps);
    await routeInboundMessage(msg, mockSocket(), "c1", deps);

    // World model deduplicates
    const frames = deps.worldModel.getRecentFrames(10);
    expect(frames).toHaveLength(1);
  });

  // ─── Intent detection ─────────────────────

  it("routes intent:parse forwards to the intent router", async () => {
    const intentHandler = vi.fn();
    deps.intentRouterDeps.handlePlannerIntent = intentHandler;

    const socket = mockSocket();
    const msg = JSON.stringify({
      type: "req",
      id: "r1",
      method: "mesh.message.forward",
      params: {
        to: "agent:pi",
        channel: "clawmesh",
        commandDraft: {
          operation: {
            name: "intent:parse",
            params: { text: "irrigate zone-1", conversationId: "conv-1" },
          },
        },
      },
    });

    const result = await routeInboundMessage(msg, socket, "c1", deps);

    expect(result).toEqual({ handled: true, kind: "intent" });
    expect(intentHandler).toHaveBeenCalledWith("irrigate zone-1", expect.any(Object));
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({
      type: "res",
      id: "r1",
      ok: true,
      payload: { accepted: true },
    }));
  });

  // ─── RPC responses ────────────────────────

  it("routes RPC responses to peer registry", async () => {
    // Set up a pending RPC
    const rpcPromise = new Promise<any>((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false }), 5000);
      // Simulate internal pending RPC state — we'll just test the routing
    });

    const msg = JSON.stringify({
      type: "res",
      id: "req-123",
      ok: true,
      payload: { data: "hello" },
    });

    const result = await routeInboundMessage(msg, mockSocket(), "c1", deps);
    expect(result).toEqual({ handled: true, kind: "rpc_response" });
  });

  it("rejects malformed RPC responses", async () => {
    const msg = JSON.stringify({ type: "res", id: 42, ok: "not boolean" });
    const result = await routeInboundMessage(msg, mockSocket(), "c1", deps);
    expect(result.handled).toBe(false);
    if (!result.handled) expect(result.reason).toBe("invalid_response");
  });

  // ─── RPC requests ─────────────────────────

  it("dispatches RPC requests to the dispatcher", async () => {
    deps.rpcDispatcher.register("test.echo", ({ params, respond }) => {
      respond(true, { echo: params.msg });
    });

    const socket = mockSocket();
    const msg = JSON.stringify({
      type: "req",
      id: "req-abc",
      method: "test.echo",
      params: { msg: "hello" },
    });

    const result = await routeInboundMessage(msg, socket, "c1", deps);
    expect(result).toEqual({ handled: true, kind: "rpc_request" });
    expect(socket.send).toHaveBeenCalled();

    const response = JSON.parse(socket.send.mock.calls[0][0]);
    expect(response.ok).toBe(true);
    expect(response.payload).toEqual({ echo: "hello" });
  });

  it("returns UNKNOWN_METHOD for unregistered RPC methods", async () => {
    const socket = mockSocket();
    const msg = JSON.stringify({
      type: "req",
      id: "req-xyz",
      method: "nonexistent",
    });

    const result = await routeInboundMessage(msg, socket, "c1", deps);
    expect(result).toEqual({ handled: true, kind: "rpc_request" });

    const response = JSON.parse(socket.send.mock.calls[0][0]);
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("UNKNOWN_METHOD");
  });

  it("rejects messages with no type field", async () => {
    const msg = JSON.stringify({ data: "no type" });
    const result = await routeInboundMessage(msg, mockSocket(), "c1", deps);
    expect(result.handled).toBe(false);
    if (!result.handled) expect(result.reason).toBe("no_type_field");
  });

  it("rejects unknown message types", async () => {
    const msg = JSON.stringify({ type: "unknown" });
    const result = await routeInboundMessage(msg, mockSocket(), "c1", deps);
    expect(result.handled).toBe(false);
    if (!result.handled) expect(result.reason).toBe("unknown_type");
  });

  it("rejects malformed RPC requests", async () => {
    const msg = JSON.stringify({ type: "req", id: 42, method: 123 });
    const result = await routeInboundMessage(msg, mockSocket(), "c1", deps);
    expect(result.handled).toBe(false);
    if (!result.handled) expect(result.reason).toBe("invalid_request");
  });
});
