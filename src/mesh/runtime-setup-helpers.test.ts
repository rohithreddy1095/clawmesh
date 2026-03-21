/**
 * Tests for RuntimeSetupHelpers — extracted wiring logic.
 */

import { describe, it, expect } from "vitest";
import { wireEventLog, restoreWorldModelSnapshot, saveWorldModelSnapshot } from "./runtime-setup-helpers.js";
import { MeshEventBus } from "./event-bus.js";
import { SystemEventLog } from "./system-event-log.js";
import { WorldModel } from "./world-model.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";

describe("wireEventLog", () => {
  it("captures peer.connected events in the log", () => {
    const bus = new MeshEventBus();
    const log = new SystemEventLog();
    wireEventLog(bus, log);

    bus.emit("peer.connected", { session: { deviceId: "abc123456789", connId: "c1", capabilities: [] } } as any);
    const events = log.recent(1);
    expect(events[0].type).toBe("peer.connect");
    expect(events[0].message).toContain("abc1234567");
  });

  it("captures peer.disconnected events in the log", () => {
    const bus = new MeshEventBus();
    const log = new SystemEventLog();
    wireEventLog(bus, log);

    bus.emit("peer.disconnected", { deviceId: "xyz987654321", reason: "timeout" });
    const events = log.recent(1);
    expect(events[0].type).toBe("peer.disconnect");
    expect(events[0].message).toContain("timeout");
  });

  it("captures proposal events in the log", () => {
    const bus = new MeshEventBus();
    const log = new SystemEventLog();
    wireEventLog(bus, log);

    bus.emit("proposal.created", { proposal: { approvalLevel: "L2", summary: "Irrigate zone-1", taskId: "t1" } } as any);
    bus.emit("proposal.resolved", { proposal: { status: "approved", summary: "Irrigate zone-1", taskId: "t1" } } as any);

    const events = log.recent(10);
    expect(events.some(e => e.type === "proposal.created")).toBe(true);
    expect(events.some(e => e.type === "proposal.resolved")).toBe(true);
  });
});

describe("restoreWorldModelSnapshot", () => {
  it("returns 0 for missing snapshot", () => {
    const wm = new WorldModel({ autoEvictTtlMs: 0, log: { info: () => {} } });
    const result = restoreWorldModelSnapshot(wm, "/nonexistent/path.json");
    expect(result).toBe(0);
  });
});

describe("saveWorldModelSnapshot", () => {
  it("saves and returns true for non-empty world model", () => {
    const wm = new WorldModel({ autoEvictTtlMs: 0, log: { info: () => {} } });
    wm.ingest({
      kind: "observation", frameId: "f1", sourceDeviceId: "s1",
      timestamp: Date.now(), data: { metric: "m", value: 1 },
      trust: { evidence_sources: ["sensor"], evidence_trust_tier: "T2_operational_observation" },
    });

    const path = join(tmpdir(), `clawmesh-snap-test-${Date.now()}.json`);
    const ok = saveWorldModelSnapshot(wm, "node-01", path);
    expect(ok).toBe(true);
    expect(existsSync(path)).toBe(true);
    try { unlinkSync(path); } catch {}
  });

  it("returns false for empty world model", () => {
    const wm = new WorldModel({ autoEvictTtlMs: 0, log: { info: () => {} } });
    const ok = saveWorldModelSnapshot(wm, "node-01", "/tmp/empty-snap.json");
    expect(ok).toBe(false);
  });
});
