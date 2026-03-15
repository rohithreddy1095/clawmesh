import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractIntentFromForward, routeIntent, type IntentRouterDeps } from "./intent-router.js";
import { ContextPropagator } from "./context-propagator.js";
import { PeerRegistry } from "./peer-registry.js";
import type { DeviceIdentity } from "../infra/device-identity.js";

const noop = { info: () => {} };

const fakeIdentity: DeviceIdentity = {
  deviceId: "router-device",
  publicKeyPem: "fake",
  privateKeyPem: "fake",
};

describe("extractIntentFromForward", () => {
  it("extracts intent from valid intent:parse forward", () => {
    const intent = extractIntentFromForward({
      to: "agent:pi",
      channel: "clawmesh",
      commandDraft: {
        operation: {
          name: "intent:parse",
          params: {
            text: "irrigate zone-1",
            conversationId: "conv-123",
          },
        },
      },
    });

    expect(intent).not.toBeNull();
    expect(intent!.text).toBe("irrigate zone-1");
    expect(intent!.conversationId).toBe("conv-123");
    expect(intent!.requestId).toBeTruthy();
  });

  it("returns null for non-agent:pi target", () => {
    const intent = extractIntentFromForward({
      to: "sensor:moisture",
      channel: "clawmesh",
      commandDraft: {
        operation: { name: "intent:parse", params: { text: "test" } },
      },
    });
    expect(intent).toBeNull();
  });

  it("returns null for non-clawmesh channel", () => {
    const intent = extractIntentFromForward({
      to: "agent:pi",
      channel: "telegram",
      commandDraft: {
        operation: { name: "intent:parse", params: { text: "test" } },
      },
    });
    expect(intent).toBeNull();
  });

  it("returns null for non-intent:parse operations", () => {
    const intent = extractIntentFromForward({
      to: "agent:pi",
      channel: "clawmesh",
      commandDraft: {
        operation: { name: "query", params: {} },
      },
    });
    expect(intent).toBeNull();
  });

  it("returns null when commandDraft is missing", () => {
    const intent = extractIntentFromForward({
      to: "agent:pi",
      channel: "clawmesh",
    });
    expect(intent).toBeNull();
  });

  it("handles missing text gracefully", () => {
    const intent = extractIntentFromForward({
      to: "agent:pi",
      channel: "clawmesh",
      commandDraft: {
        operation: { name: "intent:parse", params: {} },
      },
    });
    expect(intent).not.toBeNull();
    expect(intent!.text).toBe("Unknown intent");
  });

  it("generates conversationId when not provided", () => {
    const intent = extractIntentFromForward({
      to: "agent:pi",
      channel: "clawmesh",
      commandDraft: {
        operation: { name: "intent:parse", params: { text: "hello" } },
      },
    });
    expect(intent!.conversationId).toBeTruthy();
    expect(intent!.conversationId.length).toBeGreaterThan(0);
  });
});

describe("routeIntent", () => {
  let propagator: ContextPropagator;
  let broadcastedFrames: unknown[];
  let deps: IntentRouterDeps;

  beforeEach(() => {
    const peerRegistry = new PeerRegistry();
    propagator = new ContextPropagator({
      identity: fakeIdentity,
      peerRegistry,
      log: noop,
    });
    broadcastedFrames = [];

    deps = {
      deviceId: "test-device",
      displayName: "test-node",
      contextPropagator: propagator,
      broadcastToUI: (_event, payload) => broadcastedFrames.push(payload),
      log: noop,
    };
  });

  it("routes to planner when handlePlannerIntent is set", () => {
    const plannerHandler = vi.fn();
    deps.handlePlannerIntent = plannerHandler;

    routeIntent(
      { text: "irrigate zone-1", conversationId: "conv-1", requestId: "req-1" },
      deps,
    );

    expect(plannerHandler).toHaveBeenCalledWith("irrigate zone-1", {
      conversationId: "conv-1",
      requestId: "req-1",
    });
  });

  it("uses mock fallback when no planner is set", () => {
    vi.useFakeTimers();

    routeIntent(
      { text: "check status", conversationId: "conv-1", requestId: "req-1" },
      deps,
    );

    // Should immediately broadcast "thinking" status
    expect(broadcastedFrames).toHaveLength(1);
    const thinking = broadcastedFrames[0] as any;
    expect(thinking.data.status).toBe("thinking");

    // After 2 seconds, should broadcast mock response
    vi.advanceTimersByTime(2100);
    expect(broadcastedFrames).toHaveLength(2);
    const response = broadcastedFrames[1] as any;
    expect(response.data.status).toBe("complete");
    expect(response.data.message).toContain("check status");
    expect(response.data.message).toContain("simulated response");

    vi.useRealTimers();
  });

  it("broadcasts human_input context frame", () => {
    let broadcastedContext = false;
    propagator.onLocalBroadcast = (frame) => {
      if (frame.kind === "human_input") {
        broadcastedContext = true;
        expect(frame.data.intent).toBe("test intent");
      }
    };

    routeIntent(
      { text: "test intent", conversationId: "c", requestId: "r" },
      deps,
    );

    expect(broadcastedContext).toBe(true);
  });
});
