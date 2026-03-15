import { describe, it, expect } from "vitest";
import { rawDataToString } from "./ws.js";
import { Buffer } from "node:buffer";
import type WebSocket from "ws";

// Helper to cast to RawData type
const raw = (data: unknown) => data as WebSocket.RawData;

describe("rawDataToString", () => {
  it("handles string input", () => {
    expect(rawDataToString(raw("hello"))).toBe("hello");
  });

  it("handles Buffer input", () => {
    const buf = Buffer.from("hello buffer");
    expect(rawDataToString(raw(buf))).toBe("hello buffer");
  });

  it("handles Buffer array input", () => {
    const bufs = [Buffer.from("hello "), Buffer.from("world")];
    expect(rawDataToString(raw(bufs))).toBe("hello world");
  });

  it("handles ArrayBuffer input", () => {
    const ab = new ArrayBuffer(5);
    const view = new Uint8Array(ab);
    view.set([104, 101, 108, 108, 111]); // "hello"
    expect(rawDataToString(raw(ab))).toBe("hello");
  });

  it("handles empty string", () => {
    expect(rawDataToString(raw(""))).toBe("");
  });

  it("handles empty Buffer", () => {
    expect(rawDataToString(raw(Buffer.alloc(0)))).toBe("");
  });

  it("handles UTF-8 content", () => {
    const buf = Buffer.from("café ☕");
    expect(rawDataToString(raw(buf))).toBe("café ☕");
  });

  it("respects custom encoding", () => {
    const buf = Buffer.from("hello", "utf8");
    const hex = rawDataToString(raw(buf), "hex");
    expect(hex).toBe("68656c6c6f");
  });
});
