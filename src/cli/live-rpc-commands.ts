import type { Command } from "commander";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { rawDataToString } from "../infra/ws.js";

type NodeRpcResponse<T> = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: T;
  error?: { code?: string; message?: string } | null;
};

type MeshPeersPayload = {
  peers: Array<{
    deviceId: string;
    displayName?: string;
    outbound?: boolean;
    capabilities?: string[];
    role?: string;
    transportLabel?: string;
    connectedAtMs?: number;
  }>;
};

type MeshStatusPayload = {
  localDeviceId?: string;
  connectedPeers?: number;
  peers?: Array<{ deviceId: string; displayName?: string; role?: string }>;
  discoveryEnabled?: boolean;
  plannerMode?: string;
};

type MeshWorldPayload = {
  count: number;
  entries: number;
  frames: Array<{
    kind: string;
    frameId: string;
    sourceDeviceId: string;
    sourceDisplayName?: string;
    timestamp: number;
    data: Record<string, unknown>;
    trust: { evidence_trust_tier?: string; evidence_sources?: string[] };
    hops?: number;
  }>;
  bySourceDeviceId?: Record<string, number>;
  byKind?: Record<string, number>;
  byTrustTier?: Record<string, number>;
  peerTimestamp?: number;
};

export function registerLiveRpcCommands(program: Command): void {
  program
    .command("peers")
    .description("List currently connected mesh peers")
    .option("--url <url>", "WebSocket URL of the node", "ws://localhost:18789")
    .action(async (opts: { url: string }) => {
      try {
        const result = await callNodeRpc<MeshPeersPayload>({
          url: opts.url,
          method: "mesh.peers",
        });
        const peers = result.peers ?? [];
        if (peers.length === 0) {
          console.log("No connected peers.");
          return;
        }
        console.log(`Connected peers: ${peers.length}`);
        for (const peer of peers) {
          const direction = peer.outbound ? "outbound" : "inbound";
          const caps = peer.capabilities?.length ? peer.capabilities.join(",") : "none";
          const name = peer.displayName ? ` ${peer.displayName}` : "";
          const role = peer.role ? ` role=${peer.role}` : "";
          const transport = peer.transportLabel ? ` via=${peer.transportLabel}` : "";
          console.log(`  ${peer.deviceId}${name} ${direction}${role}${transport} caps=${caps}`);
        }
      } catch (err) {
        printRpcError(err);
      }
    });

  program
    .command("info")
    .description("Show local device identity and mesh info")
    .option("--url <url>", "WebSocket URL of the node", "ws://localhost:18789")
    .action(async (opts: { url: string }) => {
      const identity = loadOrCreateDeviceIdentity();
      console.log(`Device ID:  ${identity.deviceId}`);
      try {
        const status = await callNodeRpc<MeshStatusPayload>({
          url: opts.url,
          method: "mesh.status",
        });
        console.log(`Gateway:    reachable (${opts.url})`);
        console.log(`Runtime ID: ${status.localDeviceId ?? "unknown"}`);
        console.log(`Mesh peers: ${status.connectedPeers ?? status.peers?.length ?? 0}`);
        console.log(`Discovery:  ${status.discoveryEnabled === false ? "disabled" : "enabled"}`);
        console.log(`Planner:    ${status.plannerMode ?? "disabled"}`);
      } catch (err) {
        console.log(`Gateway:    unreachable (${opts.url})`);
        printRpcError(err);
      }
    });

  program
    .command("world")
    .description("Query the world model (requires running node)")
    .option("--url <url>", "WebSocket URL of the node", "ws://localhost:18789")
    .option("--limit <n>", "Maximum recent frames to return", (v) => Number(v), 20)
    .option("--kind <kind>", "Filter by context frame kind")
    .option("--source-device-id <deviceId>", "Filter by source deviceId")
    .action(async (opts: { url: string; limit: number; kind?: string; sourceDeviceId?: string }) => {
      try {
        const params: Record<string, unknown> = { limit: opts.limit };
        if (opts.kind) {
          params.kind = opts.kind;
        }
        if (opts.sourceDeviceId) {
          params.sourceDeviceId = opts.sourceDeviceId;
        }
        const result = await callNodeRpc<MeshWorldPayload>({
          url: opts.url,
          method: "mesh.world.query",
          params,
        });

        console.log(`World model: ${result.entries} entries, ${result.count} frames`);
        if (result.bySourceDeviceId && Object.keys(result.bySourceDeviceId).length > 0) {
          const sources = Object.entries(result.bySourceDeviceId)
            .map(([sourceDeviceId, count]) => `${sourceDeviceId}:${count}`)
            .join(", ");
          console.log(`By source:   ${sources}`);
        }
        if (result.byTrustTier && Object.keys(result.byTrustTier).length > 0) {
          const tiers = Object.entries(result.byTrustTier)
            .map(([tier, count]) => `${tier}:${count}`)
            .join(", ");
          console.log(`By tier:     ${tiers}`);
        }
        for (const frame of result.frames ?? []) {
          const tier = frame.trust?.evidence_trust_tier ?? "unknown";
          const source = frame.sourceDisplayName
            ? `${frame.sourceDisplayName}/${frame.sourceDeviceId}`
            : frame.sourceDeviceId;
          console.log(
            `  [${frame.kind}] sourceDeviceId=${source} tier=${tier} data=${formatShortJson(frame.data)}`,
          );
        }
      } catch (err) {
        printRpcError(err);
      }
    });
}

async function callNodeRpc<T>(opts: {
  url: string;
  method: string;
  params?: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<T> {
  const { WebSocket } = await import("ws");
  const id = `${opts.method}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return await new Promise<T>((resolve, reject) => {
    const ws = new WebSocket(opts.url);
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;

    const finish = (done: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      try {
        ws.close();
      } catch {
        // ignore close failures while reporting the original outcome
      }
      done();
    };

    timeout = setTimeout(() => {
      finish(() => reject(new Error(`Timeout connecting to ${opts.url}`)));
    }, opts.timeoutMs ?? 5_000);

    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "req",
        id,
        method: opts.method,
        params: opts.params ?? {},
      }));
    });

    ws.on("message", (data) => {
      let msg: NodeRpcResponse<T>;
      try {
        msg = JSON.parse(rawDataToString(data)) as NodeRpcResponse<T>;
      } catch (err) {
        finish(() => reject(new Error(`Invalid RPC response from ${opts.url}: ${String(err)}`)));
        return;
      }

      if (msg.id !== id) {
        return;
      }
      if (!msg.ok) {
        const code = msg.error?.code ? `${msg.error.code}: ` : "";
        finish(() => reject(new Error(`${opts.method} failed: ${code}${msg.error?.message ?? "unknown error"}`)));
        return;
      }
      finish(() => resolve(msg.payload as T));
    });

    ws.on("error", (err) => {
      finish(() => reject(new Error(`Failed to connect to ${opts.url}: ${err.message}`)));
    });
  });
}

function printRpcError(err: unknown): never {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

function formatShortJson(value: unknown, maxLength = 160): string {
  const raw = JSON.stringify(value);
  if (!raw || raw.length <= maxLength) {
    return raw ?? "";
  }
  return `${raw.slice(0, maxLength - 1)}…`;
}
