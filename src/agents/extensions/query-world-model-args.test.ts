import { describe, expect, it } from "vitest";
import { normalizeQueryWorldModelKind, normalizeQueryWorldModelLimit } from "./query-world-model-args.js";

describe("normalizeQueryWorldModelKind", () => {
  it("defaults missing kinds to all", () => {
    expect(normalizeQueryWorldModelKind(undefined)).toBe("all");
  });

  it("accepts exact supported kinds", () => {
    expect(normalizeQueryWorldModelKind("observation")).toBe("observation");
    expect(normalizeQueryWorldModelKind("event")).toBe("event");
    expect(normalizeQueryWorldModelKind("human_input")).toBe("human_input");
    expect(normalizeQueryWorldModelKind("inference")).toBe("inference");
    expect(normalizeQueryWorldModelKind("all")).toBe("all");
  });

  it("normalizes plural and loose aliases", () => {
    expect(normalizeQueryWorldModelKind("observations")).toBe("observation");
    expect(normalizeQueryWorldModelKind("events")).toBe("event");
    expect(normalizeQueryWorldModelKind("input")).toBe("human_input");
    expect(normalizeQueryWorldModelKind("human input")).toBe("human_input");
    expect(normalizeQueryWorldModelKind("inferences")).toBe("inference");
  });

  it("strips Gemma-style quoted wrappers and falls back safely", () => {
    expect(normalizeQueryWorldModelKind('<|"|>all<|"|>')).toBe("all");
    expect(normalizeQueryWorldModelKind('"event"')).toBe("event");
    expect(normalizeQueryWorldModelKind("`observation`")).toBe("observation");
  });

  it("falls back to all for unknown kinds", () => {
    expect(normalizeQueryWorldModelKind("agent_response")).toBe("all");
    expect(normalizeQueryWorldModelKind("something-weird")).toBe("all");
  });
});

describe("normalizeQueryWorldModelLimit", () => {
  it("uses default limit when missing or invalid", () => {
    expect(normalizeQueryWorldModelLimit(undefined)).toBe(20);
    expect(normalizeQueryWorldModelLimit("abc")).toBe(20);
  });

  it("accepts numeric and numeric-like string limits", () => {
    expect(normalizeQueryWorldModelLimit(15)).toBe(15);
    expect(normalizeQueryWorldModelLimit("15")).toBe(15);
    expect(normalizeQueryWorldModelLimit('"25"')).toBe(25);
  });

  it("clamps limits into a safe range", () => {
    expect(normalizeQueryWorldModelLimit(0)).toBe(1);
    expect(normalizeQueryWorldModelLimit(-5)).toBe(1);
    expect(normalizeQueryWorldModelLimit(500)).toBe(100);
  });
});
