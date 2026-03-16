import { describe, it, expect } from "vitest";
import { parsePeerSpec, collectOption, validatePeerSpec } from "./cli-utils.js";

describe("parsePeerSpec", () => {
  it("parses deviceId=ws://host:port format", () => {
    const result = parsePeerSpec("abc123=ws://192.168.1.39:18789");
    expect(result.deviceId).toBe("abc123");
    expect(result.url).toBe("ws://192.168.1.39:18789");
    expect(result.tlsFingerprint).toBeUndefined();
  });

  it("parses deviceId=wss://host:port|fingerprint format", () => {
    const result = parsePeerSpec("abc123=wss://jetson.local:18789|sha256:AABBCCDD");
    expect(result.deviceId).toBe("abc123");
    expect(result.url).toBe("wss://jetson.local:18789");
    expect(result.tlsFingerprint).toBe("sha256:AABBCCDD");
  });

  it("parses deviceId@ws://host:port format", () => {
    const result = parsePeerSpec("abc123@ws://10.0.0.5:18789");
    expect(result.deviceId).toBe("abc123");
    expect(result.url).toBe("ws://10.0.0.5:18789");
  });

  it("trims whitespace", () => {
    const result = parsePeerSpec("  abc  = ws://host:1234  ");
    expect(result.deviceId).toBe("abc");
    expect(result.url).toBe("ws://host:1234");
  });

  it("prefers = over @ when both present", () => {
    const result = parsePeerSpec("dev@id=ws://host:1234");
    expect(result.deviceId).toBe("dev@id");
    expect(result.url).toBe("ws://host:1234");
  });

  it("handles long SHA256 device IDs", () => {
    const sha = "a".repeat(64);
    const result = parsePeerSpec(`${sha}=ws://jetson:18789`);
    expect(result.deviceId).toBe(sha);
  });

  it("throws on empty string", () => {
    expect(() => parsePeerSpec("")).toThrow("invalid peer spec");
  });

  it("throws on missing separator", () => {
    expect(() => parsePeerSpec("just-a-string")).toThrow("invalid peer spec");
  });

  it("throws on missing deviceId (starts with =)", () => {
    expect(() => parsePeerSpec("=ws://host:1234")).toThrow("invalid peer spec");
  });

  it("throws on missing URL (ends with =)", () => {
    expect(() => parsePeerSpec("abc123=")).toThrow("invalid peer spec");
  });

  it("handles IPv6 addresses", () => {
    const result = parsePeerSpec("dev=ws://[::1]:18789");
    expect(result.url).toBe("ws://[::1]:18789");
  });
});

describe("collectOption", () => {
  it("adds first value to empty array", () => {
    expect(collectOption("value1")).toEqual(["value1"]);
  });

  it("accumulates values", () => {
    let arr = collectOption("a");
    arr = collectOption("b", arr);
    arr = collectOption("c", arr);
    expect(arr).toEqual(["a", "b", "c"]);
  });

  it("does not mutate previous array", () => {
    const prev = ["a", "b"];
    const next = collectOption("c", prev);
    expect(prev).toEqual(["a", "b"]);
    expect(next).toEqual(["a", "b", "c"]);
  });
});

describe("validatePeerSpec", () => {
  it("returns null for valid spec", () => {
    expect(validatePeerSpec("abc=ws://host:1234")).toBeNull();
  });

  it("returns error message for invalid spec", () => {
    const error = validatePeerSpec("invalid");
    expect(error).toContain("invalid peer spec");
  });

  it("returns error for empty string", () => {
    expect(validatePeerSpec("")).not.toBeNull();
  });
});
