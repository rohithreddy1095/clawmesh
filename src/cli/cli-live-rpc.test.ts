import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClawMeshCli } from "./clawmesh-cli.js";

type RpcPayloads = Record<string, unknown>;

async function withRpcServer<T>(
  payloads: RpcPayloads,
  run: (url: string, seenMethods: string[]) => Promise<T>,
): Promise<T> {
  const seenMethods: string[] = [];
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      const req = JSON.parse(data.toString()) as { id: string; method: string };
      seenMethods.push(req.method);
      const payload = payloads[req.method];
      ws.send(JSON.stringify({
        type: "res",
        id: req.id,
        ok: payload !== undefined,
        payload,
        error: payload === undefined ? { code: "UNKNOWN_METHOD", message: req.method } : undefined,
      }));
    });
  });

  const { port } = wss.address() as AddressInfo;
  try {
    return await run(`ws://127.0.0.1:${port}`, seenMethods);
  } finally {
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }
}

async function runCli(args: string[]): Promise<string[]> {
  const lines: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    lines.push(parts.map(String).join(" "));
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    lines.push(parts.map(String).join(" "));
  });
  try {
    const program = createClawMeshCli();
    program.exitOverride((err) => {
      throw err;
    });
    await program.parseAsync(["node", "clawmesh", ...args], { from: "node" });
    return lines;
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }
}

describe("live RPC CLI commands", () => {
  let tmpDir: string;
  let originalStateDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "clawmesh-cli-rpc-"));
    originalStateDir = process.env.CLAWMESH_STATE_DIR;
    process.env.CLAWMESH_STATE_DIR = tmpDir;
  });

  afterEach(() => {
    if (originalStateDir === undefined) {
      delete process.env.CLAWMESH_STATE_DIR;
    } else {
      process.env.CLAWMESH_STATE_DIR = originalStateDir;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("peers queries mesh.peers and prints connected peer truth", async () => {
    await withRpcServer({
      "mesh.peers": {
        peers: [{
          deviceId: "peer-a-device-id",
          displayName: "jetson-field-01",
          outbound: true,
          capabilities: ["channel:clawmesh", "actuator:mock"],
          role: "field",
          transportLabel: "mdns",
          connectedAtMs: 1234,
        }],
      },
    }, async (url, seenMethods) => {
      const lines = await runCli(["peers", "--url", url]);
      const output = lines.join("\n");

      expect(seenMethods).toEqual(["mesh.peers"]);
      expect(output).toContain("jetson-field-01");
      expect(output).toContain("peer-a-device-id");
      expect(output).toContain("actuator:mock");
      expect(output).not.toContain("No gateway running");
    });
  });

  it("world queries mesh.world.query and prints frame provenance", async () => {
    await withRpcServer({
      "mesh.world.query": {
        count: 1,
        entries: 1,
        frames: [{
          kind: "observation",
          frameId: "frame-1",
          sourceDeviceId: "sensor-node-1",
          sourceDisplayName: "field-sensor",
          timestamp: 1000,
          data: { zone: "zone-1", metric: "moisture", value: 31 },
          trust: {
            evidence_sources: ["sensor"],
            evidence_trust_tier: "T2_operational_observation",
          },
          hops: 1,
        }],
        bySourceDeviceId: { "sensor-node-1": 1 },
        byKind: { observation: 1 },
        byTrustTier: { T2_operational_observation: 1 },
        peerTimestamp: 2000,
      },
    }, async (url, seenMethods) => {
      const lines = await runCli(["world", "--url", url, "--limit", "5"]);
      const output = lines.join("\n");

      expect(seenMethods).toEqual(["mesh.world.query"]);
      expect(output).toContain("sensor-node-1");
      expect(output).toContain("T2_operational_observation");
      expect(output).toContain("moisture");
      expect(output).not.toContain("World model query requires a running node");
    });
  });

  it("info prints local identity plus live mesh.status when reachable", async () => {
    await withRpcServer({
      "mesh.status": {
        localDeviceId: "runtime-device-id",
        connectedPeers: 2,
        peers: [
          { deviceId: "peer-a", displayName: "jetson-field-01", role: "field" },
          { deviceId: "peer-b", displayName: "mac-node3", role: "node" },
        ],
        discoveryEnabled: true,
        plannerMode: "observing",
      },
    }, async (url, seenMethods) => {
      const lines = await runCli(["info", "--url", url]);
      const output = lines.join("\n");

      expect(seenMethods).toEqual(["mesh.status"]);
      expect(output).toContain("Device ID:");
      expect(output).toContain("Gateway:    reachable");
      expect(output).toContain("Runtime ID: runtime-device-id");
      expect(output).toContain("Mesh peers: 2");
      expect(output).toContain("Discovery:  enabled");
    });
  });
});
