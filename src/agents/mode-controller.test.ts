import { describe, it, expect, vi } from "vitest";
import { ModeController, type SessionMode } from "./mode-controller.js";

describe("ModeController", () => {
  // ─── Construction ─────────────────────────────────

  it("starts in active mode", () => {
    const mc = new ModeController();
    expect(mc.mode).toBe("active");
    expect(mc.consecutiveErrors).toBe(0);
    expect(mc.canMakeLLMCalls()).toBe(true);
  });

  it("accepts custom error threshold", () => {
    const mc = new ModeController({ errorThreshold: 5 });
    const status = mc.getStatus();
    expect(status.errorThreshold).toBe(5);
  });

  it("accepts custom observing cooldown", () => {
    const mc = new ModeController({ observingCooldownMs: 30_000 });
    expect(mc.observingCooldownMs).toBe(30_000);
  });

  // ─── setMode ──────────────────────────────────────

  it("transitions from active to observing", () => {
    const mc = new ModeController();
    const changed = mc.setMode("observing", "test");
    expect(changed).toBe(true);
    expect(mc.mode).toBe("observing");
    expect(mc.canMakeLLMCalls()).toBe(false);
  });

  it("transitions from active to suspended", () => {
    const mc = new ModeController();
    mc.setMode("suspended", "account disabled");
    expect(mc.mode).toBe("suspended");
    expect(mc.suspendReason).toBe("account disabled");
    expect(mc.canMakeLLMCalls()).toBe(false);
  });

  it("returns false when mode unchanged", () => {
    const mc = new ModeController();
    const changed = mc.setMode("active", "no change");
    expect(changed).toBe(false);
    expect(mc.mode).toBe("active");
  });

  it("calls onModeChange callback", () => {
    const changes: Array<{ mode: SessionMode; reason: string }> = [];
    const mc = new ModeController({
      onModeChange: (mode, reason) => changes.push({ mode, reason }),
    });
    mc.setMode("observing", "rate limited");
    mc.setMode("active", "recovered");
    expect(changes).toEqual([
      { mode: "observing", reason: "rate limited" },
      { mode: "active", reason: "recovered" },
    ]);
  });

  it("does not call callback when mode unchanged", () => {
    const cb = vi.fn();
    const mc = new ModeController({ onModeChange: cb });
    mc.setMode("active", "same");
    expect(cb).not.toHaveBeenCalled();
  });

  it("clears suspendReason on non-suspended mode", () => {
    const mc = new ModeController();
    mc.setMode("suspended", "error 403");
    expect(mc.suspendReason).toBe("error 403");
    mc.setMode("active", "resumed");
    expect(mc.suspendReason).toBe("");
  });

  // ─── recordFailure ────────────────────────────────

  it("increments error counter on failure", () => {
    const mc = new ModeController({ errorThreshold: 3 });
    mc.recordFailure("timeout", false);
    expect(mc.consecutiveErrors).toBe(1);
    expect(mc.mode).toBe("active"); // still below threshold
  });

  it("transitions to observing after errorThreshold failures", () => {
    const mc = new ModeController({ errorThreshold: 3 });
    mc.recordFailure("err1", false);
    mc.recordFailure("err2", false);
    expect(mc.mode).toBe("active");
    mc.recordFailure("err3", false);
    expect(mc.mode).toBe("observing");
  });

  it("immediately suspends on permanent error", () => {
    const mc = new ModeController({ errorThreshold: 10 });
    const mode = mc.recordFailure("403 Forbidden", true);
    expect(mode).toBe("suspended");
    expect(mc.mode).toBe("suspended");
    expect(mc.consecutiveErrors).toBe(1); // only one error
  });

  it("stays observing on further non-permanent failures", () => {
    const mc = new ModeController({ errorThreshold: 1 });
    mc.recordFailure("err1", false); // → observing
    expect(mc.mode).toBe("observing");
    mc.recordFailure("err2", false);
    expect(mc.mode).toBe("observing");
    expect(mc.consecutiveErrors).toBe(2);
  });

  it("updates lastErrorTime on failure", () => {
    const mc = new ModeController();
    expect(mc.lastErrorTime).toBe(0);
    mc.recordFailure("err", false);
    expect(mc.lastErrorTime).toBeGreaterThan(0);
  });

  // ─── recordSuccess ────────────────────────────────

  it("resets error counter on success", () => {
    const mc = new ModeController({ errorThreshold: 3 });
    mc.recordFailure("e1", false);
    mc.recordFailure("e2", false);
    expect(mc.consecutiveErrors).toBe(2);
    mc.recordSuccess();
    expect(mc.consecutiveErrors).toBe(0);
    expect(mc.lastErrorTime).toBe(0);
  });

  it("transitions from observing to active on success", () => {
    const mc = new ModeController({ errorThreshold: 1 });
    mc.recordFailure("err", false);
    expect(mc.mode).toBe("observing");
    mc.recordSuccess();
    expect(mc.mode).toBe("active");
  });

  it("stays active on success when already active", () => {
    const mc = new ModeController();
    mc.recordSuccess();
    expect(mc.mode).toBe("active");
  });

  // ─── resume ───────────────────────────────────────

  it("resumes from suspended to active", () => {
    const mc = new ModeController();
    mc.setMode("suspended", "403");
    expect(mc.mode).toBe("suspended");
    mc.resume("manual");
    expect(mc.mode).toBe("active");
    expect(mc.consecutiveErrors).toBe(0);
  });

  it("resumes from observing to active", () => {
    const mc = new ModeController({ errorThreshold: 1 });
    mc.recordFailure("err", false);
    expect(mc.mode).toBe("observing");
    mc.resume();
    expect(mc.mode).toBe("active");
    expect(mc.consecutiveErrors).toBe(0);
  });

  it("resume with custom reason", () => {
    const changes: string[] = [];
    const mc = new ModeController({
      errorThreshold: 1,
      onModeChange: (_m, r) => changes.push(r),
    });
    mc.recordFailure("err", false);
    mc.resume("operator override");
    expect(changes).toContain("operator override");
  });

  // ─── getStatus ────────────────────────────────────

  it("returns full status summary", () => {
    const mc = new ModeController({ errorThreshold: 5 });
    mc.recordFailure("x", false);
    mc.recordFailure("y", false);
    const status = mc.getStatus();
    expect(status).toEqual({
      mode: "active",
      consecutiveErrors: 2,
      errorThreshold: 5,
      suspendReason: "",
    });
  });

  it("status reflects suspended state", () => {
    const mc = new ModeController();
    mc.recordFailure("forbidden", true);
    const status = mc.getStatus();
    expect(status.mode).toBe("suspended");
    expect(status.suspendReason).toBe("forbidden");
  });

  // ─── Edge cases ───────────────────────────────────

  it("permanent error in observing mode still suspends", () => {
    const mc = new ModeController({ errorThreshold: 1 });
    mc.recordFailure("e1", false);
    expect(mc.mode).toBe("observing");
    mc.recordFailure("403 Forbidden", true);
    expect(mc.mode).toBe("suspended");
  });

  it("multiple resumes are idempotent", () => {
    const cb = vi.fn();
    const mc = new ModeController({ onModeChange: cb });
    mc.setMode("suspended", "test");
    cb.mockClear();
    mc.resume();
    mc.resume(); // already active — no change
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("threshold=1 transitions on first error", () => {
    const mc = new ModeController({ errorThreshold: 1 });
    mc.recordFailure("first", false);
    expect(mc.mode).toBe("observing");
  });

  it("high threshold never reaches observing with few errors", () => {
    const mc = new ModeController({ errorThreshold: 100 });
    for (let i = 0; i < 50; i++) mc.recordFailure("err", false);
    expect(mc.mode).toBe("active");
    expect(mc.consecutiveErrors).toBe(50);
  });

  // ─── Logging ──────────────────────────────────────

  it("logs info on transition to active", () => {
    const logs: string[] = [];
    const mc = new ModeController({
      log: { info: (m) => logs.push(m), warn: () => {}, error: () => {} },
    });
    mc.setMode("observing", "test");
    mc.setMode("active", "recovered");
    expect(logs.some((l) => l.includes("active") && l.includes("recovered"))).toBe(true);
  });

  it("logs warn on transition to observing", () => {
    const warns: string[] = [];
    const mc = new ModeController({
      log: { info: () => {}, warn: (m) => warns.push(m), error: () => {} },
    });
    mc.setMode("observing", "rate limited");
    expect(warns.some((l) => l.includes("observing"))).toBe(true);
  });

  it("logs error on transition to suspended", () => {
    const errors: string[] = [];
    const mc = new ModeController({
      log: { info: () => {}, warn: () => {}, error: (m) => errors.push(m) },
    });
    mc.setMode("suspended", "forbidden");
    expect(errors.some((l) => l.includes("suspended"))).toBe(true);
  });
});
