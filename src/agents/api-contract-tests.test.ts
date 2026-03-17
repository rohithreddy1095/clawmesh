/**
 * Comprehensive API contract tests — validates public interfaces
 * of all extracted modules remain stable.
 */

import { describe, it, expect } from "vitest";
import { ModeController } from "./mode-controller.js";
import { ProposalManager } from "./proposal-manager.js";
import { TriggerQueue, TRIGGER_PRIORITIES } from "./trigger-queue.js";
import { PatternMemory } from "./pattern-memory.js";
import { MeshEventBus } from "../mesh/event-bus.js";
import { RpcDispatcher } from "../mesh/rpc-dispatcher.js";
import { MeshCapabilityRegistry } from "../mesh/capabilities.js";
import { TrustAuditTrail } from "../mesh/trust-audit.js";

describe("ModeController API contract", () => {
  const ctrl = new ModeController({ errorThreshold: 3, observingCooldownMs: 5000 });

  it("has mode getter", () => expect(ctrl.mode).toBe("active"));
  it("has consecutiveErrors getter", () => expect(ctrl.consecutiveErrors).toBe(0));
  it("has lastErrorTime getter", () => expect(ctrl.lastErrorTime).toBe(0));
  it("has suspendReason getter", () => expect(ctrl.suspendReason).toBe(""));
  it("has observingCooldownMs getter", () => expect(ctrl.observingCooldownMs).toBe(5000));
  it("has canMakeLLMCalls method", () => expect(ctrl.canMakeLLMCalls()).toBe(true));
  it("has getStatus method", () => {
    const status = ctrl.getStatus();
    expect(status).toHaveProperty("mode");
    expect(status).toHaveProperty("consecutiveErrors");
    expect(status).toHaveProperty("errorThreshold");
  });
  it("setMode returns boolean", () => expect(typeof ctrl.setMode("observing", "test")).toBe("boolean"));
  it("recordFailure returns SessionMode", () => {
    const ctrl2 = new ModeController();
    const result = ctrl2.recordFailure("test", false);
    expect(["active", "observing", "suspended"]).toContain(result);
  });
  it("recordSuccess is callable", () => { ctrl.recordSuccess(); });
  it("resume is callable", () => { ctrl.resume(); });
});

describe("ProposalManager API contract", () => {
  const pm = new ProposalManager();

  it("has add method", () => expect(typeof pm.add).toBe("function"));
  it("has get method", () => expect(pm.get("none")).toBeUndefined());
  it("has list method", () => expect(pm.list()).toEqual([]));
  it("has countPending method", () => expect(pm.countPending()).toBe(0));
  it("has approve method", () => expect(pm.approve("none")).toBeNull());
  it("has reject method", () => expect(pm.reject("none")).toBeNull());
  it("has findByPrefix method", () => expect(pm.findByPrefix("x")).toBeUndefined());
  it("has complete method", () => expect(pm.complete("x", { ok: true })).toBeNull());
  it("has getMap method", () => expect(pm.getMap()).toBeInstanceOf(Map));
  it("has clear method", () => { pm.clear(); expect(pm.size).toBe(0); });
  it("has size getter", () => expect(pm.size).toBe(0));
});

describe("TriggerQueue API contract", () => {
  const q = new TriggerQueue();

  it("has isEmpty getter", () => expect(q.isEmpty).toBe(true));
  it("has length getter", () => expect(q.length).toBe(0));
  it("has enqueueIntent method", () => { q.enqueueIntent("test"); });
  it("has enqueueThresholdBreach method", () => {
    q.enqueueThresholdBreach({ ruleId: "r", promptHint: "p", metric: "m", frame: {} as any });
  });
  it("has enqueueProactiveCheck method", () => { q.enqueueProactiveCheck([]); });
  it("has drain method", () => {
    const { operatorIntents, systemTriggers } = q.drain();
    expect(Array.isArray(operatorIntents)).toBe(true);
    expect(Array.isArray(systemTriggers)).toBe(true);
  });
  it("TRIGGER_PRIORITIES has expected keys", () => {
    expect(TRIGGER_PRIORITIES).toHaveProperty("operator_intent");
    expect(TRIGGER_PRIORITIES).toHaveProperty("threshold_breach");
    expect(TRIGGER_PRIORITIES).toHaveProperty("proactive_check");
  });
});

describe("MeshEventBus API contract", () => {
  const bus = new MeshEventBus();

  it("has on method", () => expect(typeof bus.on).toBe("function"));
  it("has once method", () => expect(typeof bus.once).toBe("function"));
  it("has emit method", () => expect(typeof bus.emit).toBe("function"));
  it("on returns unsubscribe function", () => {
    const unsub = bus.on("peer.connected", () => {});
    expect(typeof unsub).toBe("function");
    unsub();
  });
  it("emit with no listeners is safe", () => {
    bus.emit("runtime.started", undefined as any);
  });
});

describe("RpcDispatcher API contract", () => {
  const dispatcher = new RpcDispatcher();

  it("has register method", () => expect(typeof dispatcher.register).toBe("function"));
  it("has dispatch method", () => expect(typeof dispatcher.dispatch).toBe("function"));
  it("has listMethods method", () => {
    const methods = dispatcher.listMethods();
    expect(Array.isArray(methods)).toBe(true);
  });
  it("register adds a method handler", () => {
    dispatcher.register("test.echo", () => {});
    expect(dispatcher.listMethods()).toContain("test.echo");
  });
});

describe("MeshCapabilityRegistry API contract", () => {
  const reg = new MeshCapabilityRegistry();

  it("has findPeersWithCapability method", () => {
    const peers = reg.findPeersWithCapability("sensor:moisture");
    expect(Array.isArray(peers)).toBe(true);
  });
  it("has listAll method", () => {
    const all = reg.listAll();
    expect(Array.isArray(all)).toBe(true);
  });
  it("updatePeer stores capabilities for a device", () => {
    reg.updatePeer("device-01", ["sensor:moisture", "sensor:temp"]);
    const peers = reg.findPeersWithCapability("sensor:moisture");
    expect(peers).toContain("device-01");
  });
});

describe("TrustAuditTrail API contract", () => {
  const audit = new TrustAuditTrail();

  it("has record method", () => expect(typeof audit.record).toBe("function"));
  it("has query method", () => {
    const results = audit.query({});
    expect(Array.isArray(results)).toBe(true);
  });
  it("has getStats method", () => {
    const stats = audit.getStats();
    expect(stats).toHaveProperty("total");
    expect(stats).toHaveProperty("approved");
    expect(stats).toHaveProperty("rejected");
  });
});
