/**
 * Tests for message validation — size and format checks.
 */

import { describe, it, expect } from "vitest";
import {
  validateMessageSize,
  validateMessageStructure,
  validateAndParse,
  MAX_MESSAGE_SIZE,
  MAX_FRAME_DATA_SIZE,
} from "./message-validation.js";

describe("validateMessageSize", () => {
  it("accepts normal size message", () => {
    expect(validateMessageSize('{"type":"req"}')).toEqual({ valid: true });
  });

  it("accepts message at limit", () => {
    const msg = "x".repeat(MAX_MESSAGE_SIZE);
    expect(validateMessageSize(msg)).toEqual({ valid: true });
  });

  it("rejects oversized message", () => {
    const msg = "x".repeat(MAX_MESSAGE_SIZE + 1);
    const result = validateMessageSize(msg);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("TOO_LARGE");
  });

  it("accepts empty string", () => {
    expect(validateMessageSize("")).toEqual({ valid: true });
  });
});

describe("validateMessageStructure", () => {
  it("accepts valid req message", () => {
    expect(validateMessageStructure({ type: "req", id: "1", method: "test" })).toEqual({ valid: true });
  });

  it("accepts valid res message", () => {
    expect(validateMessageStructure({ type: "res", id: "1", ok: true })).toEqual({ valid: true });
  });

  it("accepts valid event message", () => {
    expect(validateMessageStructure({ type: "event", event: "test" })).toEqual({ valid: true });
  });

  it("rejects null", () => {
    const result = validateMessageStructure(null);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("INVALID_JSON");
  });

  it("rejects non-object", () => {
    expect(validateMessageStructure("string").valid).toBe(false);
    expect(validateMessageStructure(42).valid).toBe(false);
  });

  it("rejects missing type field", () => {
    const result = validateMessageStructure({ id: "1" });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("MISSING_TYPE");
  });

  it("rejects invalid type", () => {
    const result = validateMessageStructure({ type: "invalid" });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("INVALID_TYPE");
    expect(result.error).toContain("invalid");
  });

  it("rejects oversized event payload", () => {
    const result = validateMessageStructure({
      type: "event",
      payload: { data: "x".repeat(MAX_FRAME_DATA_SIZE + 1) },
    });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("DATA_TOO_LARGE");
  });

  it("accepts normal-sized event payload", () => {
    expect(validateMessageStructure({
      type: "event",
      payload: { data: "hello" },
    })).toEqual({ valid: true });
  });
});

describe("validateAndParse", () => {
  it("parses valid JSON message", () => {
    const result = validateAndParse('{"type":"req","id":"1","method":"test"}');
    expect(result.parsed).not.toBeNull();
    expect(result.parsed?.type).toBe("req");
  });

  it("rejects oversized raw message", () => {
    const result = validateAndParse("x".repeat(MAX_MESSAGE_SIZE + 1));
    expect(result.parsed).toBeNull();
    expect(result.code).toBe("TOO_LARGE");
  });

  it("rejects invalid JSON", () => {
    const result = validateAndParse("{not valid json}");
    expect(result.parsed).toBeNull();
    expect(result.code).toBe("INVALID_JSON");
  });

  it("rejects structurally invalid message", () => {
    const result = validateAndParse('{"type":"bogus"}');
    expect(result.parsed).toBeNull();
    expect(result.code).toBe("INVALID_TYPE");
  });

  it("full valid pipeline", () => {
    const msg = JSON.stringify({ type: "event", event: "context.frame", payload: { data: "test" } });
    const result = validateAndParse(msg);
    expect(result.parsed).not.toBeNull();
    expect(result.error).toBeUndefined();
  });

  it("empty string is invalid JSON after parse", () => {
    const result = validateAndParse("");
    expect(result.parsed).toBeNull();
  });
});
