import { describe, it, expect } from "vitest";
import {
  deriveActuatorStatus,
  isActivation,
  isDeactivation,
  isActuatorRef,
  isSensorRef,
  parseTargetRef,
} from "./actuator-logic.js";

// ─── deriveActuatorStatus ───────────────────────────

describe("deriveActuatorStatus", () => {
  it("open → active", () => {
    expect(deriveActuatorStatus("open")).toBe("active");
  });

  it("start → active", () => {
    expect(deriveActuatorStatus("start")).toBe("active");
  });

  it("on → active", () => {
    expect(deriveActuatorStatus("on")).toBe("active");
  });

  it("enable → active", () => {
    expect(deriveActuatorStatus("enable")).toBe("active");
  });

  it("close → inactive", () => {
    expect(deriveActuatorStatus("close")).toBe("inactive");
  });

  it("stop → inactive", () => {
    expect(deriveActuatorStatus("stop")).toBe("inactive");
  });

  it("off → inactive", () => {
    expect(deriveActuatorStatus("off")).toBe("inactive");
  });

  it("disable → inactive", () => {
    expect(deriveActuatorStatus("disable")).toBe("inactive");
  });

  it("case insensitive", () => {
    expect(deriveActuatorStatus("START")).toBe("active");
    expect(deriveActuatorStatus("STOP")).toBe("inactive");
    expect(deriveActuatorStatus("Open")).toBe("active");
  });

  it("set with state param uses state value", () => {
    expect(deriveActuatorStatus("set", { state: "half-open" })).toBe("half-open");
  });

  it("set without state param → command:set", () => {
    expect(deriveActuatorStatus("set", { value: 42 })).toBe("command:set");
  });

  it("set with non-string state → command:set", () => {
    expect(deriveActuatorStatus("set", { state: 42 })).toBe("command:set");
  });

  it("unknown operation → command:name", () => {
    expect(deriveActuatorStatus("calibrate")).toBe("command:calibrate");
    expect(deriveActuatorStatus("reset")).toBe("command:reset");
  });

  it("no params for unknown → command:name", () => {
    expect(deriveActuatorStatus("custom")).toBe("command:custom");
  });
});

// ─── isActivation ───────────────────────────────────

describe("isActivation", () => {
  it("recognizes activation ops", () => {
    expect(isActivation("start")).toBe(true);
    expect(isActivation("open")).toBe(true);
    expect(isActivation("on")).toBe(true);
    expect(isActivation("enable")).toBe(true);
  });

  it("case insensitive", () => {
    expect(isActivation("START")).toBe(true);
    expect(isActivation("Open")).toBe(true);
  });

  it("rejects non-activation ops", () => {
    expect(isActivation("stop")).toBe(false);
    expect(isActivation("close")).toBe(false);
    expect(isActivation("custom")).toBe(false);
  });
});

// ─── isDeactivation ─────────────────────────────────

describe("isDeactivation", () => {
  it("recognizes deactivation ops", () => {
    expect(isDeactivation("stop")).toBe(true);
    expect(isDeactivation("close")).toBe(true);
    expect(isDeactivation("off")).toBe(true);
    expect(isDeactivation("disable")).toBe(true);
  });

  it("case insensitive", () => {
    expect(isDeactivation("STOP")).toBe(true);
    expect(isDeactivation("Close")).toBe(true);
  });

  it("rejects non-deactivation ops", () => {
    expect(isDeactivation("start")).toBe(false);
    expect(isDeactivation("open")).toBe(false);
    expect(isDeactivation("custom")).toBe(false);
  });
});

// ─── isActuatorRef / isSensorRef ────────────────────

describe("isActuatorRef", () => {
  it("matches actuator refs", () => {
    expect(isActuatorRef("actuator:pump:P1")).toBe(true);
    expect(isActuatorRef("actuator:valve:V1")).toBe(true);
  });

  it("rejects non-actuator refs", () => {
    expect(isActuatorRef("sensor:moisture:zone-1")).toBe(false);
    expect(isActuatorRef("channel:telegram")).toBe(false);
  });
});

describe("isSensorRef", () => {
  it("matches sensor refs", () => {
    expect(isSensorRef("sensor:moisture:zone-1")).toBe(true);
    expect(isSensorRef("sensor:temperature")).toBe(true);
  });

  it("rejects non-sensor refs", () => {
    expect(isSensorRef("actuator:pump:P1")).toBe(false);
    expect(isSensorRef("channel:telegram")).toBe(false);
  });
});

// ─── parseTargetRef ─────────────────────────────────

describe("parseTargetRef", () => {
  it("parses three-part ref", () => {
    const result = parseTargetRef("actuator:pump:P1");
    expect(result).toEqual({
      type: "actuator",
      subtype: "pump",
      identifier: "P1",
    });
  });

  it("parses two-part ref", () => {
    const result = parseTargetRef("sensor:moisture");
    expect(result).toEqual({
      type: "sensor",
      subtype: "moisture",
      identifier: "",
    });
  });

  it("parses single-part ref", () => {
    const result = parseTargetRef("channel");
    expect(result).toEqual({
      type: "channel",
      subtype: "",
      identifier: "",
    });
  });

  it("handles multi-colon identifier", () => {
    const result = parseTargetRef("actuator:valve:zone-1:V1");
    expect(result).toEqual({
      type: "actuator",
      subtype: "valve",
      identifier: "zone-1:V1",
    });
  });

  it("handles empty string", () => {
    const result = parseTargetRef("");
    expect(result).toEqual({ type: "", subtype: "", identifier: "" });
  });
});
