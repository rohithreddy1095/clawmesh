import { describe, it, expect } from "vitest";
import { strip, dw, pad, trunc, fit, fg, bg, BOLD, RST, C, B } from "./ansi.js";

describe("strip", () => {
  it("removes ANSI escape codes", () => {
    expect(strip(`${BOLD}hello${RST}`)).toBe("hello");
  });

  it("handles multiple codes", () => {
    expect(strip(`${C.orange}hi${RST} ${C.green}world${RST}`)).toBe("hi world");
  });

  it("handles plain text", () => {
    expect(strip("no codes")).toBe("no codes");
  });

  it("handles empty string", () => {
    expect(strip("")).toBe("");
  });
});

describe("dw (display width)", () => {
  it("returns visible character count", () => {
    expect(dw("hello")).toBe(5);
  });

  it("ignores ANSI codes", () => {
    expect(dw(`${C.orange}hello${RST}`)).toBe(5);
  });

  it("returns 0 for empty string", () => {
    expect(dw("")).toBe(0);
  });
});

describe("pad", () => {
  it("pads plain text", () => {
    expect(pad("hi", 5)).toBe("hi   ");
  });

  it("pads styled text correctly", () => {
    const styled = `${C.orange}hi${RST}`;
    const padded = pad(styled, 5);
    expect(dw(padded)).toBe(5);
    expect(strip(padded)).toBe("hi   ");
  });

  it("does not pad if already at width", () => {
    expect(pad("hello", 5)).toBe("hello");
  });

  it("returns empty for width 0", () => {
    expect(pad("hello", 0)).toBe("");
  });
});

describe("trunc", () => {
  it("truncates long plain text", () => {
    const result = trunc("hello world", 8);
    expect(strip(result)).toBe("hello w…");
  });

  it("does not truncate short text", () => {
    const result = trunc("hi", 10);
    expect(result).toBe("hi");
  });

  it("preserves ANSI codes", () => {
    const styled = `${C.orange}hello world${RST}`;
    const result = trunc(styled, 8);
    const visible = strip(result);
    expect(visible).toBe("hello w…");
    // Should contain ANSI escape sequences
    expect(result).toContain("\x1b[");
  });

  it("returns empty for width 0", () => {
    expect(trunc("hello", 0)).toBe("");
  });
});

describe("fit", () => {
  it("truncates long text to width", () => {
    const result = fit("hello world", 8);
    expect(dw(result)).toBe(8);
    expect(strip(result)).toBe("hello w…");
  });

  it("pads short text to width", () => {
    const result = fit("hi", 8);
    expect(dw(result)).toBe(8);
    expect(strip(result)).toBe("hi      ");
  });

  it("exact width returns as-is", () => {
    const result = fit("hello", 5);
    expect(strip(result)).toBe("hello");
  });
});

describe("fg / bg", () => {
  it("fg generates foreground color code", () => {
    expect(fg(255, 0, 0)).toBe("\x1b[38;2;255;0;0m");
  });

  it("bg generates background color code", () => {
    expect(bg(0, 255, 0)).toBe("\x1b[48;2;0;255;0m");
  });
});

describe("brand palette", () => {
  it("all palette colors are ANSI codes", () => {
    for (const [, value] of Object.entries(C)) {
      expect(value).toContain("\x1b[");
    }
  });
});

describe("box drawing", () => {
  it("exports all box drawing characters", () => {
    expect(B.tl).toBe("┌");
    expect(B.tr).toBe("┐");
    expect(B.bl).toBe("└");
    expect(B.br).toBe("┘");
    expect(B.h).toBe("─");
    expect(B.v).toBe("│");
  });
});
