import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { addTrustedPeer } from "./peer-trust.js";
import { buildLlmOnlyActuationTrust, MeshNodeRuntime } from "./node-runtime.js";

describe("MeshNodeRuntime", () => {
  let tempStateDir: string;
  let prevStateDir: string | undefined;
  let nodeA: MeshNodeRuntime | null = null;
  let nodeB: MeshNodeRuntime | null = null;

  beforeEach(() => {
    prevStateDir = process.env.OPENCLAW_STATE_DIR;
    tempStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawmesh-runtime-test-"));
    process.env.OPENCLAW_STATE_DIR = tempStateDir;
  });

  afterEach(async () => {
    if (nodeA) {
      await nodeA.stop();
      nodeA = null;
    }
    if (nodeB) {
      await nodeB.stop();
      nodeB = null;
    }
    if (prevStateDir == null) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = prevStateDir;
    }
    fs.rmSync(tempStateDir, { recursive: true, force: true });
  });

  async function startOrSkip(runtime: MeshNodeRuntime) {
    try {
      return await runtime.start();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === "EPERM" || code === "EACCES") {
        return null;
      }
      throw err;
    }
  }

  it("connects two nodes and applies a trusted mock actuator command end-to-end", async () => {
    const identityA = loadOrCreateDeviceIdentity(path.join(tempStateDir, "id-a.json"));
    const identityB = loadOrCreateDeviceIdentity(path.join(tempStateDir, "id-b.json"));

    await addTrustedPeer({ deviceId: identityA.deviceId, displayName: "node-a" });
    await addTrustedPeer({ deviceId: identityB.deviceId, displayName: "node-b" });

    nodeB = new MeshNodeRuntime({
      identity: identityB,
      host: "127.0.0.1",
      port: 0,
      enableMockActuator: true,
      capabilities: ["channel:clawmesh", "actuator:mock"],
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const addrB = await startOrSkip(nodeB);
    if (!addrB) {
      return;
    }

    nodeA = new MeshNodeRuntime({
      identity: identityA,
      host: "127.0.0.1",
      port: 0,
      capabilities: ["channel:clawmesh"],
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    if (!(await startOrSkip(nodeA))) {
      return;
    }
    nodeA.connectToPeer({
      deviceId: identityB.deviceId,
      url: `ws://127.0.0.1:${addrB.port}`,
    });

    const connected = await nodeA.waitForPeerConnected(identityB.deviceId, 10_000);
    expect(connected).toBe(true);

    const forward = await nodeA.sendMockActuation({
      peerDeviceId: identityB.deviceId,
      targetRef: "actuator:mock:valve-1",
      operation: "open",
      operationParams: { durationSec: 45 },
      note: "runtime test",
    });
    expect(forward.ok).toBe(true);

    const state = await nodeA.queryPeerMockActuatorState({
      peerDeviceId: identityB.deviceId,
      targetRef: "actuator:mock:valve-1",
    });

    expect(state.ok).toBe(true);
    const payload = state.payload as {
      records: Array<{ targetRef: string; status: string; lastOperation?: string }>;
    };
    expect(payload.records).toHaveLength(1);
    expect(payload.records[0]).toMatchObject({
      targetRef: "actuator:mock:valve-1",
      status: "active",
      lastOperation: "open",
    });
  });

  it("rejects llm-only actuation in runtime mesh flow", async () => {
    const identityA = loadOrCreateDeviceIdentity(path.join(tempStateDir, "id-a2.json"));
    const identityB = loadOrCreateDeviceIdentity(path.join(tempStateDir, "id-b2.json"));

    await addTrustedPeer({ deviceId: identityA.deviceId, displayName: "node-a2" });
    await addTrustedPeer({ deviceId: identityB.deviceId, displayName: "node-b2" });

    nodeB = new MeshNodeRuntime({
      identity: identityB,
      host: "127.0.0.1",
      port: 0,
      enableMockActuator: true,
      capabilities: ["channel:clawmesh", "actuator:mock"],
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const addrB = await startOrSkip(nodeB);
    if (!addrB) {
      return;
    }

    nodeA = new MeshNodeRuntime({
      identity: identityA,
      host: "127.0.0.1",
      port: 0,
      capabilities: ["channel:clawmesh"],
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    if (!(await startOrSkip(nodeA))) {
      return;
    }
    nodeA.connectToPeer({
      deviceId: identityB.deviceId,
      url: `ws://127.0.0.1:${addrB.port}`,
    });

    const connected = await nodeA.waitForPeerConnected(identityB.deviceId, 10_000);
    expect(connected).toBe(true);

    // LLM-only actuation: sender-side trust evaluation should reject
    const forward = await nodeA.sendMockActuation({
      peerDeviceId: identityB.deviceId,
      targetRef: "actuator:mock:pump-1",
      operation: "start",
      trust: buildLlmOnlyActuationTrust(),
    });

    expect(forward.ok).toBe(false);
    expect(forward.error).toContain("LLM_ONLY_ACTUATION_BLOCKED");

    // Verify the actuator was never reached (no state change)
    const state = await nodeA.queryPeerMockActuatorState({
      peerDeviceId: identityB.deviceId,
      targetRef: "actuator:mock:pump-1",
    });
    expect(state.ok).toBe(true);
    const payload = state.payload as { records: unknown[] };
    expect(payload.records).toHaveLength(0);
  });

  it("rejects actuation with insufficient trust tier at sender", async () => {
    const identityA = loadOrCreateDeviceIdentity(path.join(tempStateDir, "id-a3.json"));
    const identityB = loadOrCreateDeviceIdentity(path.join(tempStateDir, "id-b3.json"));

    await addTrustedPeer({ deviceId: identityA.deviceId, displayName: "node-a3" });
    await addTrustedPeer({ deviceId: identityB.deviceId, displayName: "node-b3" });

    nodeB = new MeshNodeRuntime({
      identity: identityB,
      host: "127.0.0.1",
      port: 0,
      enableMockActuator: true,
      capabilities: ["channel:clawmesh", "actuator:mock"],
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const addrB = await startOrSkip(nodeB);
    if (!addrB) {
      return;
    }

    nodeA = new MeshNodeRuntime({
      identity: identityA,
      host: "127.0.0.1",
      port: 0,
      capabilities: ["channel:clawmesh"],
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    if (!(await startOrSkip(nodeA))) {
      return;
    }
    nodeA.connectToPeer({
      deviceId: identityB.deviceId,
      url: `ws://127.0.0.1:${addrB.port}`,
    });

    const connected = await nodeA.waitForPeerConnected(identityB.deviceId, 10_000);
    expect(connected).toBe(true);

    // Insufficient trust tier: T1 evidence but T2 required
    const forward = await nodeA.sendMockActuation({
      peerDeviceId: identityB.deviceId,
      targetRef: "actuator:mock:pump-1",
      operation: "start",
      trust: {
        action_type: "actuation",
        evidence_sources: ["sensor"],
        evidence_trust_tier: "T1_unverified_observation",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "none",
      },
    });

    expect(forward.ok).toBe(false);
    expect(forward.error).toContain("INSUFFICIENT_TRUST_TIER");
  });

  it("rejects actuation with unsatisfied verification at sender", async () => {
    const identityA = loadOrCreateDeviceIdentity(path.join(tempStateDir, "id-a4.json"));
    const identityB = loadOrCreateDeviceIdentity(path.join(tempStateDir, "id-b4.json"));

    await addTrustedPeer({ deviceId: identityA.deviceId, displayName: "node-a4" });
    await addTrustedPeer({ deviceId: identityB.deviceId, displayName: "node-b4" });

    nodeB = new MeshNodeRuntime({
      identity: identityB,
      host: "127.0.0.1",
      port: 0,
      enableMockActuator: true,
      capabilities: ["channel:clawmesh", "actuator:mock"],
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const addrB = await startOrSkip(nodeB);
    if (!addrB) {
      return;
    }

    nodeA = new MeshNodeRuntime({
      identity: identityA,
      host: "127.0.0.1",
      port: 0,
      capabilities: ["channel:clawmesh"],
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    if (!(await startOrSkip(nodeA))) {
      return;
    }
    nodeA.connectToPeer({
      deviceId: identityB.deviceId,
      url: `ws://127.0.0.1:${addrB.port}`,
    });

    const connected = await nodeA.waitForPeerConnected(identityB.deviceId, 10_000);
    expect(connected).toBe(true);

    // Human verification required but not satisfied
    const forward = await nodeA.sendMockActuation({
      peerDeviceId: identityB.deviceId,
      targetRef: "actuator:mock:pump-1",
      operation: "start",
      trust: {
        action_type: "actuation",
        evidence_sources: ["sensor", "human"],
        evidence_trust_tier: "T3_verified_action_evidence",
        minimum_trust_tier: "T2_operational_observation",
        verification_required: "human",
        // verification_satisfied intentionally omitted
      },
    });

    expect(forward.ok).toBe(false);
    expect(forward.error).toContain("VERIFICATION_REQUIRED");
  });
});
