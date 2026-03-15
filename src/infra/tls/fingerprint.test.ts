import { describe, it, expect } from "vitest";
import { normalizeFingerprint } from "./fingerprint.js";

describe("normalizeFingerprint", () => {
  it("normalizes colon-separated hex", () => {
    expect(normalizeFingerprint("AB:CD:EF:12:34")).toBe("abcdef1234");
  });

  it("removes sha256: prefix", () => {
    expect(normalizeFingerprint("sha256:AABBCCDD")).toBe("aabbccdd");
  });

  it("removes SHA-256: prefix (with hyphen)", () => {
    expect(normalizeFingerprint("SHA-256:AABBCCDD")).toBe("aabbccdd");
  });

  it("handles mixed case", () => {
    expect(normalizeFingerprint("AbCdEf")).toBe("abcdef");
  });

  it("handles whitespace", () => {
    expect(normalizeFingerprint("  AB CD EF  ")).toBe("abcdef");
  });

  it("handles already normalized input", () => {
    expect(normalizeFingerprint("abcdef1234")).toBe("abcdef1234");
  });

  it("handles empty string", () => {
    expect(normalizeFingerprint("")).toBe("");
  });

  it("strips non-hex characters", () => {
    expect(normalizeFingerprint("ab-cd:ef.12_34")).toBe("abcdef1234");
  });
});
