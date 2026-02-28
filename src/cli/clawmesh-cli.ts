import { Command } from "commander";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { buildLlmOnlyActuationTrust, MeshNodeRuntime } from "../mesh/node-runtime.js";
import {
  addTrustedPeer,
  listTrustedPeers,
  removeTrustedPeer,
} from "../mesh/peer-trust.js";
import type { MeshStaticPeer } from "../config/types.mesh.js";

function collectOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function parsePeerSpec(spec: string): MeshStaticPeer {
  const trimmed = spec.trim();
  const separator = trimmed.includes("=") ? "=" : "@";
  const sepIndex = trimmed.indexOf(separator);
  if (sepIndex <= 0 || sepIndex >= trimmed.length - 1) {
    throw new Error(`invalid peer spec "${spec}" (use "<deviceId>=<ws://host:port>")`);
  }
  const deviceIdRaw = trimmed.slice(0, sepIndex);
  const restRaw = trimmed.slice(sepIndex + 1);
  const [urlRaw, tlsFingerprint] = restRaw.split("|");
  const deviceId = deviceIdRaw.trim();
  const url = urlRaw?.trim();
  if (!deviceId || !url) {
    throw new Error(`invalid peer spec "${spec}" (use "<deviceId>=<ws://host:port>")`);
  }
  return {
    deviceId,
    url,
    tlsFingerprint: tlsFingerprint?.trim() || undefined,
  };
}

export function createClawMeshCli(): Command {
  const program = new Command();
  program
    .name("clawmesh")
    .description("ClawMesh — mesh-first AI gateway")
    .version("0.1.0");

  // ── identity ─────────────────────────────────────────────
  program
    .command("identity")
    .description("Print this device's mesh identity (deviceId and public key)")
    .action(() => {
      const identity = loadOrCreateDeviceIdentity();
      console.log(`Device ID:   ${identity.deviceId}`);
      console.log(`Public Key:\n${identity.publicKeyPem.trim()}`);
    });

  // ── runtime ──────────────────────────────────────────────
  program
    .command("start")
    .description("Start a minimal mesh runtime node")
    .option("--host <host>", "Host interface to bind", "0.0.0.0")
    .option("--port <port>", "Port to listen on", (v) => Number(v), 18789)
    .option("--name <name>", "Display name for this node")
    .option(
      "--capability <capability>",
      "Capability to advertise (repeatable)",
      collectOption,
      [],
    )
    .option(
      "--peer <deviceId=url>",
      'Static peer to connect (format: "<deviceId>=<ws://host:port>" or "<deviceId>=<url>|<tlsFingerprint>")',
      collectOption,
      [],
    )
    .option("--mock-actuator", "Enable mock actuator handler for clawmesh commands")
    .action(
      async (opts: {
        host: string;
        port: number;
        name?: string;
        capability: string[];
        peer: string[];
        mockActuator?: boolean;
      }) => {
        const identity = loadOrCreateDeviceIdentity();
        const staticPeers = opts.peer.map(parsePeerSpec);
        const runtime = new MeshNodeRuntime({
          identity,
          host: opts.host,
          port: opts.port,
          displayName: opts.name,
          capabilities: opts.capability,
          staticPeers,
          enableMockActuator: !!opts.mockActuator,
          log: {
            info: (msg) => console.log(msg),
            warn: (msg) => console.warn(msg),
            error: (msg) => console.error(msg),
          },
        });

        await runtime.start();
        const address = runtime.listenAddress();
        const capabilities = runtime.getAdvertisedCapabilities();

        console.log(`Device ID:   ${identity.deviceId}`);
        console.log(`Listening:   ws://${address.host}:${address.port}`);
        console.log(`Capabilities: ${capabilities.length > 0 ? capabilities.join(", ") : "(none)"}`);
        if (opts.mockActuator) {
          console.log("Mock actuator: enabled");
        }
        if (staticPeers.length > 0) {
          console.log(`Static peers: ${staticPeers.length}`);
        }
        console.log("Press Ctrl+C to stop.");

        await new Promise<void>((resolve) => {
          const shutdown = async () => {
            process.off("SIGINT", onSignal);
            process.off("SIGTERM", onSignal);
            await runtime.stop();
            resolve();
          };
          const onSignal = () => {
            void shutdown();
          };
          process.once("SIGINT", onSignal);
          process.once("SIGTERM", onSignal);
        });
      },
    );

  program
    .command("demo-actuate")
    .description("Connect to a peer and send one mock actuator command for trust-gating tests")
    .requiredOption(
      "--peer <deviceId=url>",
      'Target peer to connect (format: "<deviceId>=<ws://host:port>")',
    )
    .option("--target <targetRef>", "Mock actuator target", "actuator:mock:valve-1")
    .option("--operation <name>", "Operation name", "open")
    .option("--duration-sec <seconds>", "Optional duration parameter", (v) => Number(v))
    .option("--note <note>", "Optional note/audit message")
    .option("--llm-only", "Send intentionally unsafe LLM-only trust metadata (should be rejected)")
    .option("--timeout-ms <ms>", "Peer connect timeout", (v) => Number(v), 12_000)
    .action(
      async (opts: {
        peer: string;
        target: string;
        operation: string;
        durationSec?: number;
        note?: string;
        llmOnly?: boolean;
        timeoutMs: number;
      }) => {
        const peer = parsePeerSpec(opts.peer);
        const identity = loadOrCreateDeviceIdentity();
        const runtime = new MeshNodeRuntime({
          identity,
          host: "127.0.0.1",
          port: 0,
          capabilities: ["channel:clawmesh"],
          log: {
            info: (msg) => console.log(msg),
            warn: (msg) => console.warn(msg),
            error: (msg) => console.error(msg),
          },
        });

        await runtime.start();
        runtime.connectToPeer(peer);

        const connected = await runtime.waitForPeerConnected(peer.deviceId, opts.timeoutMs);
        if (!connected) {
          await runtime.stop();
          throw new Error(`timed out waiting for peer ${peer.deviceId}`);
        }

        const operationParams =
          typeof opts.durationSec === "number" && Number.isFinite(opts.durationSec)
            ? { durationSec: opts.durationSec }
            : undefined;

        const forward = await runtime.sendMockActuation({
          peerDeviceId: peer.deviceId,
          targetRef: opts.target,
          operation: opts.operation,
          operationParams,
          note: opts.note,
          trust: opts.llmOnly ? buildLlmOnlyActuationTrust() : undefined,
        });

        console.log(`Forward result: ${JSON.stringify(forward)}`);
        const state = await runtime.queryPeerMockActuatorState({
          peerDeviceId: peer.deviceId,
          targetRef: opts.target,
        });
        console.log(`Remote mock actuator state: ${JSON.stringify(state.payload ?? state.error)}`);

        await runtime.stop();
      },
    );

  // ── trust ────────────────────────────────────────────────
  const trust = program
    .command("trust")
    .description("Manage trusted mesh peers");

  trust
    .command("list")
    .description("List all trusted peers")
    .action(async () => {
      const peers = await listTrustedPeers();
      if (peers.length === 0) {
        console.log("No trusted peers.");
        return;
      }
      for (const peer of peers) {
        const name = peer.displayName ? ` (${peer.displayName})` : "";
        console.log(`  ${peer.deviceId}${name}  added ${peer.addedAt}`);
      }
    });

  trust
    .command("add <deviceId>")
    .description("Add a peer to the trust store")
    .option("--name <name>", "Display name for the peer")
    .action(async (deviceId: string, opts: { name?: string }) => {
      const result = await addTrustedPeer({
        deviceId,
        displayName: opts.name,
      });
      if (result.added) {
        console.log(`Trusted peer added: ${deviceId}`);
      } else {
        console.log(`Peer already trusted: ${deviceId}`);
      }
    });

  trust
    .command("remove <deviceId>")
    .description("Remove a peer from the trust store")
    .action(async (deviceId: string) => {
      const result = await removeTrustedPeer(deviceId);
      if (result.removed) {
        console.log(`Peer removed: ${deviceId}`);
      } else {
        console.log(`Peer not found: ${deviceId}`);
      }
    });

  // ── peers ────────────────────────────────────────────────
  program
    .command("peers")
    .description("List currently connected mesh peers")
    .action(() => {
      // In a running gateway, this would query PeerRegistry.
      // For now, print a placeholder until the gateway server is running.
      console.log("No gateway running. Start with `clawmesh start` first.");
    });

  // ── status ───────────────────────────────────────────────
  program
    .command("status")
    .description("Show gateway and mesh status")
    .action(() => {
      const identity = loadOrCreateDeviceIdentity();
      console.log(`Device ID:  ${identity.deviceId}`);
      console.log("Gateway:    not running");
      console.log("Mesh peers: 0");
    });

  return program;
}
