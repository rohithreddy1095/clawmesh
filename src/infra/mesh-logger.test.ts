import { describe, it, expect, beforeEach, vi } from "vitest";
import { MeshLogger, createStructuredLogger, type LogEntry } from "./mesh-logger.js";

describe("MeshLogger", () => {
  let lines: string[];
  let logger: MeshLogger;

  beforeEach(() => {
    lines = [];
    logger = new MeshLogger({
      component: "test",
      output: "human",
      writer: (line) => lines.push(line),
    });
  });

  // ─── Basic logging ─────────────────────────

  it("logs info messages", () => {
    logger.info("hello world");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("INFO");
    expect(lines[0]).toContain("[test]");
    expect(lines[0]).toContain("hello world");
  });

  it("logs warn messages", () => {
    logger.warn("watch out");
    expect(lines[0]).toContain("WARN");
    expect(lines[0]).toContain("watch out");
  });

  it("logs error messages", () => {
    logger.error("something broke");
    expect(lines[0]).toContain("ERROR");
    expect(lines[0]).toContain("something broke");
  });

  it("logs debug messages when minLevel is debug", () => {
    const debugLogger = new MeshLogger({
      component: "test",
      minLevel: "debug",
      writer: (line) => lines.push(line),
    });
    debugLogger.debug("debug detail");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("DEBUG");
  });

  // ─── Level filtering ───────────────────────

  it("filters messages below minLevel", () => {
    const warnLogger = new MeshLogger({
      component: "test",
      minLevel: "warn",
      writer: (line) => lines.push(line),
    });
    warnLogger.debug("should not appear");
    warnLogger.info("should not appear");
    warnLogger.warn("should appear");
    warnLogger.error("should appear");
    expect(lines).toHaveLength(2);
  });

  it("default minLevel is info", () => {
    logger.debug("hidden");
    logger.info("visible");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("visible");
  });

  // ─── Structured data ───────────────────────

  it("includes data in human format", () => {
    logger.info("peer connected", { deviceId: "abc123", port: 18789 });
    expect(lines[0]).toContain("abc123");
    expect(lines[0]).toContain("18789");
  });

  // ─── JSON output ───────────────────────────

  it("outputs JSON when format is json", () => {
    const jsonLogger = new MeshLogger({
      component: "mesh",
      output: "json",
      correlationId: "corr-123",
      deviceId: "device-abc",
      writer: (line) => lines.push(line),
    });

    jsonLogger.info("frame ingested", { frameId: "f-1" });

    const entry: LogEntry = JSON.parse(lines[0]);
    expect(entry.level).toBe("info");
    expect(entry.component).toBe("mesh");
    expect(entry.message).toBe("frame ingested");
    expect(entry.correlationId).toBe("corr-123");
    expect(entry.deviceId).toBe("device-abc");
    expect(entry.data).toEqual({ frameId: "f-1" });
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // ─── Correlation ID ────────────────────────

  it("includes correlation ID in human format", () => {
    const corrLogger = new MeshLogger({
      component: "test",
      correlationId: "abcdefghijklmnop",
      writer: (line) => lines.push(line),
    });
    corrLogger.info("test");
    expect(lines[0]).toContain("(abcdefghijkl)"); // Truncated to 12 chars
  });

  // ─── Child logger ──────────────────────────

  it("creates child logger with overridden component", () => {
    const child = logger.child({ component: "planner" });
    child.info("child message");
    expect(lines[0]).toContain("[planner]");
  });

  it("child inherits parent settings", () => {
    const parent = new MeshLogger({
      component: "mesh",
      correlationId: "parent-corr",
      writer: (line) => lines.push(line),
    });
    const child = parent.child({ component: "peer" });
    child.info("inherited");
    expect(lines[0]).toContain("[peer]");
    expect(lines[0]).toContain("parent-corr");
  });

  it("child can override correlationId", () => {
    const child = logger.child({ correlationId: "new-corr" });
    child.info("test");
    expect(lines[0]).toContain("new-corr");
  });

  // ─── Legacy interface ──────────────────────

  it("toLegacy returns compatible interface", () => {
    const legacy = logger.toLegacy();
    legacy.info("legacy info");
    legacy.warn("legacy warn");
    legacy.error("legacy error");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("INFO");
    expect(lines[1]).toContain("WARN");
    expect(lines[2]).toContain("ERROR");
  });

  // ─── Human format structure ────────────────

  it("human format includes timestamp component and message", () => {
    logger.info("structured");
    // Format: HH:MM:SS.mmm LEVEL [component] message
    expect(lines[0]).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3} INFO\s+\[test\] structured/);
  });
});

describe("createStructuredLogger", () => {
  it("creates a JSON-output logger", () => {
    const lines: string[] = [];
    const logger = createStructuredLogger({
      component: "mesh",
      writer: (line) => lines.push(line),
    });
    logger.info("test");
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });
});
