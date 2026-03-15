import { describe, it, expect, beforeEach } from "vitest";
import { MockActuatorController, createMockActuatorHandlers } from "./mock-actuator.js";
import type { MeshForwardPayload, ClawMeshCommandEnvelopeV1 } from "./types.js";

const noop = { info: () => {}, warn: () => {} };

function makeForwardPayload(
  overrides?: Partial<ClawMeshCommandEnvelopeV1>,
): MeshForwardPayload {
  const command: ClawMeshCommandEnvelopeV1 = {
    version: 1,
    kind: "clawmesh.command",
    commandId: "cmd-" + Math.random().toString(36).slice(2, 8),
    createdAtMs: Date.now(),
    source: { nodeId: "planner", role: "planner" },
    target: { kind: "capability", ref: "actuator:pump:P1" },
    operation: { name: "start" },
    trust: {
      action_type: "actuation",
      evidence_trust_tier: "T3_verified_action_evidence",
      minimum_trust_tier: "T2_operational_observation",
      verification_required: "human",
      verification_satisfied: true,
      evidence_sources: ["sensor", "human"],
      approved_by: ["operator"],
    },
    ...overrides,
  };

  return {
    channel: "clawmesh",
    to: command.target.ref,
    originGatewayId: "gateway-1",
    idempotencyKey: "idem-1",
    command,
    trust: command.trust,
  };
}

describe("MockActuatorController", () => {
  let controller: MockActuatorController;

  beforeEach(() => {
    controller = new MockActuatorController({ log: noop });
  });

  it("handles actuator start command", async () => {
    await controller.handleForward(makeForwardPayload({
      target: { kind: "capability", ref: "actuator:pump:P1" },
      operation: { name: "start" },
    }));

    const snapshot = controller.snapshot();
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records[0].targetRef).toBe("actuator:pump:P1");
    expect(snapshot.records[0].status).toBe("active");
    expect(snapshot.records[0].lastOperation).toBe("start");
  });

  it("handles actuator stop command", async () => {
    await controller.handleForward(makeForwardPayload({
      target: { kind: "capability", ref: "actuator:pump:P1" },
      operation: { name: "stop" },
    }));

    const snapshot = controller.snapshot();
    expect(snapshot.records[0].status).toBe("inactive");
  });

  it("derives status from operation name", async () => {
    const ops = [
      { name: "open", expected: "active" },
      { name: "close", expected: "inactive" },
      { name: "on", expected: "active" },
      { name: "off", expected: "inactive" },
      { name: "enable", expected: "active" },
      { name: "disable", expected: "inactive" },
    ];

    for (const { name, expected } of ops) {
      const ctrl = new MockActuatorController({ log: noop });
      await ctrl.handleForward(makeForwardPayload({
        target: { kind: "capability", ref: `actuator:${name}-test` },
        operation: { name },
      }));
      const snap = ctrl.snapshot();
      expect(snap.records[0].status).toBe(expected);
    }
  });

  it("handles set operation with state param", async () => {
    await controller.handleForward(makeForwardPayload({
      target: { kind: "capability", ref: "actuator:valve:V1" },
      operation: { name: "set", params: { state: "half-open" } },
    }));

    const snapshot = controller.snapshot();
    expect(snapshot.records[0].status).toBe("half-open");
  });

  it("ignores non-clawmesh channel", async () => {
    const payload = makeForwardPayload();
    payload.channel = "telegram";
    await controller.handleForward(payload);

    const snapshot = controller.snapshot();
    expect(snapshot.records).toHaveLength(0);
  });

  it("ignores commands without command envelope", async () => {
    const payload: MeshForwardPayload = {
      channel: "clawmesh",
      to: "actuator:pump:P1",
      originGatewayId: "gw",
      idempotencyKey: "k",
    };
    await controller.handleForward(payload);

    const snapshot = controller.snapshot();
    expect(snapshot.records).toHaveLength(0);
  });

  it("ignores non-actuator targets", async () => {
    await controller.handleForward(makeForwardPayload({
      target: { kind: "capability", ref: "sensor:moisture:z1" },
    }));

    const snapshot = controller.snapshot();
    expect(snapshot.records).toHaveLength(0);
  });

  it("tracks command history", async () => {
    await controller.handleForward(makeForwardPayload({
      operation: { name: "start" },
    }));
    await controller.handleForward(makeForwardPayload({
      operation: { name: "stop" },
    }));

    const snapshot = controller.snapshot();
    expect(snapshot.history).toHaveLength(2);
    expect(snapshot.history[0].operation).toBe("start");
    expect(snapshot.history[1].operation).toBe("stop");
  });

  it("snapshot filters by targetRef", async () => {
    await controller.handleForward(makeForwardPayload({
      target: { kind: "capability", ref: "actuator:pump:P1" },
    }));
    await controller.handleForward(makeForwardPayload({
      target: { kind: "capability", ref: "actuator:valve:V1" },
    }));

    const p1Snapshot = controller.snapshot({ targetRef: "actuator:pump:P1" });
    expect(p1Snapshot.records).toHaveLength(1);
    expect(p1Snapshot.records[0].targetRef).toBe("actuator:pump:P1");
  });

  it("trims history to maxHistory", async () => {
    const smallCtrl = new MockActuatorController({ maxHistory: 3, log: noop });

    for (let i = 0; i < 5; i++) {
      await smallCtrl.handleForward(makeForwardPayload({
        operation: { name: `op-${i}` },
      }));
    }

    const snapshot = smallCtrl.snapshot();
    expect(snapshot.history).toHaveLength(3);
    expect(snapshot.history[0].operation).toBe("op-2"); // First 2 trimmed
  });
});

describe("createMockActuatorHandlers", () => {
  it("creates clawmesh.mock.actuator.state handler", () => {
    const controller = new MockActuatorController({ log: noop });
    const handlers = createMockActuatorHandlers({ controller });
    expect(handlers["clawmesh.mock.actuator.state"]).toBeDefined();
  });

  it("handler returns actuator snapshot", async () => {
    const controller = new MockActuatorController({ log: noop });
    await controller.handleForward(makeForwardPayload());

    const handlers = createMockActuatorHandlers({ controller });
    let responsePayload: any;

    await handlers["clawmesh.mock.actuator.state"]({
      params: {},
      respond: (ok, payload) => {
        expect(ok).toBe(true);
        responsePayload = payload;
      },
    });

    expect(responsePayload.records).toHaveLength(1);
    expect(responsePayload.history).toHaveLength(1);
  });
});
