import { describe, expect, it } from "vitest";
import { formatDeviceIdShort } from "../ui/src/lib/device-id.js";

describe("formatDeviceIdShort", () => {
  it("keeps short ids unchanged", () => {
    expect(formatDeviceIdShort("abc123")).toBe("abc123");
  });

  it("truncates long ids for compact UI display", () => {
    expect(formatDeviceIdShort("fb1621b47a389a492e6927cd2dec91e9f383701d153fca76b265f58503b0a387")).toBe("fb1621b47a38…");
  });
});
