import { describe, it, expect, vi, beforeEach } from "vitest";
import { MeshEventBus } from "./event-bus.js";
import type { ContextFrame } from "./context-types.js";
import type { TaskProposal } from "../agents/types.js";

function makeFrame(overrides?: Partial<ContextFrame>): ContextFrame {
  return {
    kind: "observation",
    frameId: "test-frame-1",
    sourceDeviceId: "device-abc",
    sourceDisplayName: "test-node",
    timestamp: Date.now(),
    data: { metric: "soil_moisture", value: 25.3, zone: "zone-1" },
    trust: {
      evidence_sources: ["sensor"],
      evidence_trust_tier: "T2_operational_observation",
    },
    ...overrides,
  };
}

function makeProposal(overrides?: Partial<TaskProposal>): TaskProposal {
  return {
    taskId: "task-001",
    summary: "Start pump P1",
    reasoning: "Zone-1 moisture critical at 15%",
    targetRef: "actuator:pump:P1",
    operation: "start",
    peerDeviceId: "device-xyz",
    approvalLevel: "L2",
    status: "awaiting_approval",
    createdBy: "intelligence",
    triggerFrameIds: ["frame-abc"],
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("MeshEventBus", () => {
  let bus: MeshEventBus;

  beforeEach(() => {
    bus = new MeshEventBus();
  });

  // ─── Basic subscription ──────────────────────

  it("delivers events to subscribers", () => {
    const handler = vi.fn();
    bus.on("context.frame.ingested", handler);

    const frame = makeFrame();
    bus.emit("context.frame.ingested", { frame });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ frame });
  });

  it("supports multiple subscribers for the same event", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    bus.on("context.frame.ingested", handler1);
    bus.on("context.frame.ingested", handler2);

    const frame = makeFrame();
    bus.emit("context.frame.ingested", { frame });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it("does not cross-deliver between event types", () => {
    const ingestHandler = vi.fn();
    const broadcastHandler = vi.fn();
    bus.on("context.frame.ingested", ingestHandler);
    bus.on("context.frame.broadcast", broadcastHandler);

    const frame = makeFrame();
    bus.emit("context.frame.ingested", { frame });

    expect(ingestHandler).toHaveBeenCalledOnce();
    expect(broadcastHandler).not.toHaveBeenCalled();
  });

  // ─── Unsubscribe ─────────────────────────────

  it("returns cleanup function that unsubscribes", () => {
    const handler = vi.fn();
    const cleanup = bus.on("peer.connected", handler);

    cleanup();

    bus.emit("peer.connected", {
      session: {
        deviceId: "abc",
        connId: "conn-1",
        socket: null as any,
        outbound: false,
        capabilities: [],
        connectedAtMs: Date.now(),
      },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("removeAllListeners clears specific event", () => {
    const handler = vi.fn();
    bus.on("proposal.created", handler);

    bus.removeAllListeners("proposal.created");
    bus.emit("proposal.created", { proposal: makeProposal() });

    expect(handler).not.toHaveBeenCalled();
  });

  it("removeAllListeners() with no args clears everything", () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on("peer.connected", h1);
    bus.on("proposal.created", h2);

    bus.removeAllListeners();
    bus.emit("peer.connected", {
      session: {
        deviceId: "x",
        connId: "c",
        socket: null as any,
        outbound: false,
        capabilities: [],
        connectedAtMs: Date.now(),
      },
    });
    bus.emit("proposal.created", { proposal: makeProposal() });

    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  // ─── once ────────────────────────────────────

  it("once() fires handler exactly once", () => {
    const handler = vi.fn();
    bus.once("runtime.started", handler);

    bus.emit("runtime.started", { host: "0.0.0.0", port: 18789 });
    bus.emit("runtime.started", { host: "0.0.0.0", port: 18789 });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ host: "0.0.0.0", port: 18789 });
  });

  it("once() cleanup can cancel before fire", () => {
    const handler = vi.fn();
    const cleanup = bus.once("runtime.stopping", handler);

    cleanup();
    bus.emit("runtime.stopping", {});

    expect(handler).not.toHaveBeenCalled();
  });

  // ─── Event type coverage ─────────────────────

  it("handles peer.disconnected events", () => {
    const handler = vi.fn();
    bus.on("peer.disconnected", handler);

    bus.emit("peer.disconnected", { deviceId: "abc123", reason: "timeout" });

    expect(handler).toHaveBeenCalledWith({
      deviceId: "abc123",
      reason: "timeout",
    });
  });

  it("handles operator.intent events", () => {
    const handler = vi.fn();
    bus.on("operator.intent", handler);

    bus.emit("operator.intent", {
      text: "irrigate zone-1",
      conversationId: "conv-1",
      requestId: "req-1",
      source: "telegram",
    });

    expect(handler).toHaveBeenCalledWith({
      text: "irrigate zone-1",
      conversationId: "conv-1",
      requestId: "req-1",
      source: "telegram",
    });
  });

  it("handles threshold.breach events", () => {
    const handler = vi.fn();
    bus.on("threshold.breach", handler);

    const frame = makeFrame({ data: { metric: "soil_moisture", value: 12, zone: "zone-1" } });
    bus.emit("threshold.breach", {
      ruleId: "rule-1",
      metric: "soil_moisture",
      value: 12,
      zone: "zone-1",
      promptHint: "Moisture critical",
      frame,
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].ruleId).toBe("rule-1");
  });

  it("handles proposal.resolved events", () => {
    const handler = vi.fn();
    bus.on("proposal.resolved", handler);

    const proposal = makeProposal({ status: "approved" });
    bus.emit("proposal.resolved", { proposal });

    expect(handler).toHaveBeenCalledWith({ proposal });
    expect(handler.mock.calls[0][0].proposal.status).toBe("approved");
  });

  it("handles ui.broadcast events", () => {
    const handler = vi.fn();
    bus.on("ui.broadcast", handler);

    bus.emit("ui.broadcast", {
      event: "context.frame",
      payload: { kind: "observation", data: {} },
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].event).toBe("context.frame");
  });

  // ─── Listener count ──────────────────────────

  it("reports correct listener count", () => {
    expect(bus.listenerCount("peer.connected")).toBe(0);

    const cleanup1 = bus.on("peer.connected", () => {});
    const cleanup2 = bus.on("peer.connected", () => {});
    expect(bus.listenerCount("peer.connected")).toBe(2);

    cleanup1();
    expect(bus.listenerCount("peer.connected")).toBe(1);

    cleanup2();
    expect(bus.listenerCount("peer.connected")).toBe(0);
  });

  // ─── Edge cases ──────────────────────────────

  it("emitting with no subscribers does not throw", () => {
    expect(() => {
      bus.emit("runtime.started", { host: "0.0.0.0", port: 18789 });
    }).not.toThrow();
  });

  it("handles rapid sequential emits", () => {
    const handler = vi.fn();
    bus.on("context.frame.ingested", handler);

    for (let i = 0; i < 100; i++) {
      bus.emit("context.frame.ingested", {
        frame: makeFrame({ frameId: `frame-${i}` }),
      });
    }

    expect(handler).toHaveBeenCalledTimes(100);
  });
});
