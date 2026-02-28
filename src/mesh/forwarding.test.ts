import { describe, expect, it, vi, beforeEach } from "vitest";
import { forwardMessageToPeer } from "./forwarding.js";
import { PeerRegistry } from "./peer-registry.js";
import type { PeerSession } from "./types.js";

function createMockSocket() {
  const send = vi.fn();
  const close = vi.fn();
  return {
    socket: { send, close, readyState: 1 } as unknown as PeerSession["socket"],
    send,
    close,
  };
}

describe("forwardMessageToPeer()", () => {
  let peerRegistry: PeerRegistry;

  beforeEach(() => {
    peerRegistry = new PeerRegistry();
  });

  it("invokes mesh.message.forward RPC on the target peer", async () => {
    const { socket, send } = createMockSocket();
    peerRegistry.register({
      deviceId: "peer-b",
      connId: "conn-1",
      socket,
      outbound: true,
      capabilities: ["channel:telegram"],
      connectedAtMs: Date.now(),
    });

    // Start the forward — it will pend waiting for RPC response
    const forwardPromise = forwardMessageToPeer({
      peerRegistry,
      peerDeviceId: "peer-b",
      channel: "telegram",
      to: "user-123",
      message: "Hello from mesh",
      originGatewayId: "local-gw",
    });

    // Verify the RPC was sent
    expect(send).toHaveBeenCalledOnce();
    const sentFrame = JSON.parse(send.mock.calls[0][0] as string);
    expect(sentFrame.type).toBe("req");
    expect(sentFrame.method).toBe("mesh.message.forward");
    expect(sentFrame.params.channel).toBe("telegram");
    expect(sentFrame.params.to).toBe("user-123");
    expect(sentFrame.params.message).toBe("Hello from mesh");
    expect(sentFrame.params.originGatewayId).toBe("local-gw");

    // Respond to complete the RPC
    peerRegistry.handleRpcResult({
      id: sentFrame.id,
      ok: true,
      payload: { messageId: "msg-abc" },
    });

    const result = await forwardPromise;
    expect(result).toEqual({ ok: true, messageId: "msg-abc" });
  });

  it("includes originGatewayId for loop prevention", async () => {
    const { socket, send } = createMockSocket();
    peerRegistry.register({
      deviceId: "peer-b",
      connId: "conn-1",
      socket,
      outbound: true,
      capabilities: [],
      connectedAtMs: Date.now(),
    });

    const forwardPromise = forwardMessageToPeer({
      peerRegistry,
      peerDeviceId: "peer-b",
      channel: "whatsapp",
      to: "user-456",
      originGatewayId: "gateway-origin",
    });

    const sentFrame = JSON.parse(send.mock.calls[0][0] as string);
    expect(sentFrame.params.originGatewayId).toBe("gateway-origin");

    peerRegistry.handleRpcResult({ id: sentFrame.id, ok: true, payload: {} });
    await forwardPromise;
  });

  it("returns { ok: true, messageId } on success", async () => {
    const { socket, send } = createMockSocket();
    peerRegistry.register({
      deviceId: "peer-b",
      connId: "conn-1",
      socket,
      outbound: true,
      capabilities: [],
      connectedAtMs: Date.now(),
    });

    const forwardPromise = forwardMessageToPeer({
      peerRegistry,
      peerDeviceId: "peer-b",
      channel: "telegram",
      to: "user-1",
      message: "hi",
      originGatewayId: "gw-1",
    });

    const sentFrame = JSON.parse(send.mock.calls[0][0] as string);
    peerRegistry.handleRpcResult({
      id: sentFrame.id,
      ok: true,
      payload: { messageId: "msg-xyz" },
    });

    const result = await forwardPromise;
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe("msg-xyz");
  });

  it("returns { ok: false, error } on RPC failure", async () => {
    const result = await forwardMessageToPeer({
      peerRegistry,
      peerDeviceId: "nonexistent-peer",
      channel: "telegram",
      to: "user-1",
      originGatewayId: "gw-1",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("generates idempotencyKey when not provided", async () => {
    const { socket, send } = createMockSocket();
    peerRegistry.register({
      deviceId: "peer-b",
      connId: "conn-1",
      socket,
      outbound: true,
      capabilities: [],
      connectedAtMs: Date.now(),
    });

    const forwardPromise = forwardMessageToPeer({
      peerRegistry,
      peerDeviceId: "peer-b",
      channel: "telegram",
      to: "user-1",
      originGatewayId: "gw-1",
    });

    const sentFrame = JSON.parse(send.mock.calls[0][0] as string);
    expect(sentFrame.params.idempotencyKey).toBeTruthy();
    expect(typeof sentFrame.params.idempotencyKey).toBe("string");

    peerRegistry.handleRpcResult({ id: sentFrame.id, ok: true, payload: {} });
    await forwardPromise;
  });

  it("passes trust metadata through to mesh.message.forward", async () => {
    const { socket, send } = createMockSocket();
    peerRegistry.register({
      deviceId: "peer-b",
      connId: "conn-1",
      socket,
      outbound: true,
      capabilities: [],
      connectedAtMs: Date.now(),
    });

    const forwardPromise = forwardMessageToPeer({
      peerRegistry,
      peerDeviceId: "peer-b",
      channel: "clawmesh",
      to: "actuator:pump:main",
      message: "start",
      originGatewayId: "gw-1",
      trust: {
        action_type: "actuation",
        evidence_sources: ["sensor", "human"],
        evidence_trust_tier: "T3_verified_action_evidence",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "human",
        verification_satisfied: true,
      },
    });

    const sentFrame = JSON.parse(send.mock.calls[0][0] as string);
    expect(sentFrame.params.trust).toMatchObject({
      action_type: "actuation",
      minimum_trust_tier: "T2_operational_observation",
      verification_required: "human",
    });

    peerRegistry.handleRpcResult({ id: sentFrame.id, ok: true, payload: {} });
    await forwardPromise;
  });

  it("derives top-level trust from commandDraft for consistent runtime enforcement", async () => {
    const { socket, send } = createMockSocket();
    peerRegistry.register({
      deviceId: "peer-b",
      connId: "conn-1",
      socket,
      outbound: true,
      capabilities: [],
      connectedAtMs: Date.now(),
    });

    const forwardPromise = forwardMessageToPeer({
      peerRegistry,
      peerDeviceId: "peer-b",
      channel: "clawmesh",
      to: "actuator:valve:zone-a",
      originGatewayId: "gw-1",
      commandDraft: {
        source: { nodeId: "mac-claw", role: "planner" },
        target: { kind: "capability", ref: "actuator:valve:zone-a" },
        operation: { name: "open", params: { durationSec: 30 } },
        trust: {
          action_type: "actuation",
          evidence_sources: ["sensor", "human"],
          evidence_trust_tier: "T3_verified_action_evidence",
          minimum_trust_tier: "T2_operational_observation",
          verification_required: "human",
          verification_satisfied: true,
        },
      },
    });

    const sentFrame = JSON.parse(send.mock.calls[0][0] as string);
    expect(sentFrame.params.command).toMatchObject({
      kind: "clawmesh.command",
      version: 1,
      target: { kind: "capability", ref: "actuator:valve:zone-a" },
      operation: { name: "open" },
    });
    expect(sentFrame.params.trust).toEqual(sentFrame.params.command.trust);

    peerRegistry.handleRpcResult({ id: sentFrame.id, ok: true, payload: {} });
    await forwardPromise;
  });
});
