import { Command } from "commander";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { buildLlmOnlyActuationTrust, MeshNodeRuntime } from "../mesh/node-runtime.js";
import { MockSensor } from "../mesh/mock-sensor.js";
import { connectToGateway } from "../mesh/gateway-connect.js";
import {
  addTrustedPeer,
  listTrustedPeers,
  removeTrustedPeer,
} from "../mesh/peer-trust.js";
import type { MeshStaticPeer, MeshGatewayTarget } from "../config/types.mesh.js";
import { loadGatewayTargets, saveGatewayTarget } from "../mesh/gateway-config.js";
import { rawDataToString } from "../infra/ws.js";

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
    .option("--mock-sensor", "Enable mock sensor (broadcasts periodic moisture readings)")
    .option("--sensor-interval <ms>", "Mock sensor interval in milliseconds", (v) => Number(v), 5000)
    .action(
      async (opts: {
        host: string;
        port: number;
        name?: string;
        capability: string[];
        peer: string[];
        mockActuator?: boolean;
        mockSensor?: boolean;
        sensorInterval: number;
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
        if (opts.mockSensor) {
          const mockSensor = new MockSensor({
            contextPropagator: runtime.contextPropagator,
            intervalMs: opts.sensorInterval,
            zone: "zone-1",
          });
          mockSensor.start();
          console.log(`Mock sensor: enabled (${opts.sensorInterval}ms interval)`);
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

  // ── gateway-connect ─────────────────────────────────────
  program
    .command("gateway-connect [name]")
    .description("Connect to a remote OpenClaw gateway")
    .option("--url <url>", "Gateway WebSocket URL (e.g. ws://192.168.1.39:18789)")
    .option("--password <password>", "Gateway auth password")
    .option("--token <token>", "Gateway auth token")
    .option("--role <role>", "Role to request", "node")
    .option("--name <displayName>", "Display name for this node")
    .option("--save", "Save this gateway target to config for future use")
    .option("--timeout-ms <ms>", "Connection timeout", (v) => Number(v), 15_000)
    .action(
      async (
        targetName: string | undefined,
        opts: {
          url?: string;
          password?: string;
          token?: string;
          role: string;
          name?: string;
          save?: boolean;
          timeoutMs: number;
        },
      ) => {
        const identity = loadOrCreateDeviceIdentity();

        // Resolve target: from saved config or CLI flags
        let url = opts.url;
        let password = opts.password;
        let token = opts.token;
        let displayName = opts.name;

        if (targetName && !url) {
          const targets = loadGatewayTargets();
          const target = targets.find((t) => t.name === targetName);
          if (!target) {
            const available = targets.map((t) => t.name).join(", ") || "(none)";
            console.error(`Unknown gateway target "${targetName}". Available: ${available}`);
            process.exit(1);
          }
          url = target.url;
          password = password ?? target.password;
          token = token ?? target.token;
          displayName = displayName ?? target.displayName;
        }

        if (!url) {
          console.error("Missing --url or saved gateway target name.");
          console.error("Usage: clawmesh gateway-connect --url ws://host:port [--password ...]");
          console.error("   or: clawmesh gateway-connect <saved-name>");
          process.exit(1);
        }

        console.log(`Device ID:  ${identity.deviceId}`);
        console.log(`Target:     ${url}`);

        const result = await connectToGateway({
          url,
          identity,
          password,
          token,
          role: opts.role,
          displayName: displayName ?? "clawmesh",
          timeoutMs: opts.timeoutMs,
          log: {
            info: (msg) => console.log(msg),
            warn: (msg) => console.warn(msg),
            error: (msg) => console.error(msg),
          },
        });

        if (!result.ok) {
          console.error(`\nConnection failed: ${result.error}`);
          process.exit(1);
        }

        console.log(`\nConnected to gateway`);
        console.log(`  Server:   ${result.server?.version}`);
        console.log(`  ConnId:   ${result.server?.connId}`);
        console.log(`  Protocol: ${result.protocol}`);
        console.log(`  Methods:  ${result.methods?.length ?? 0} available`);
        console.log(`  Events:   ${result.events?.length ?? 0} available`);
        if (result.auth) {
          console.log(`  Auth:     device token issued, role=${result.auth.role}`);
        }
        if (result.presence && result.presence.length > 0) {
          console.log(`  Presence: ${result.presence.length} nodes`);
          for (const p of result.presence) {
            const host = p.host ?? p.id ?? "unknown";
            const platform = p.platform ?? "?";
            const mode = p.mode ?? "?";
            const roles = (p.roles ?? []).join(",") || "none";
            console.log(`    - ${host} (${platform}/${mode}) roles=${roles}`);
          }
        }

        // Save target if requested
        if (opts.save && targetName) {
          saveGatewayTarget({
            name: targetName,
            url,
            password,
            token,
            role: opts.role,
            displayName,
          });
          console.log(`\nSaved gateway target "${targetName}".`);
        }

        // Keep alive and print events
        const ws = result.ws;
        if (!ws) {
          return;
        }
        console.log("\nListening for events... (Ctrl+C to disconnect)");

        ws.on("message", (data) => {
          try {
            const msg = JSON.parse(rawDataToString(data));
            if (msg.type === "event") {
              const ts = new Date().toISOString().slice(11, 19);
              console.log(`  [${ts}] event: ${msg.event}`);
            }
          } catch {
            // ignore
          }
        });

        ws.on("close", (code, reason) => {
          console.log(`\nDisconnected (${code}): ${rawDataToString(reason)}`);
          process.exit(0);
        });

        await new Promise<void>((resolve) => {
          const shutdown = () => {
            process.off("SIGINT", onSignal);
            process.off("SIGTERM", onSignal);
            ws.close();
            resolve();
          };
          const onSignal = () => void shutdown();
          process.once("SIGINT", onSignal);
          process.once("SIGTERM", onSignal);
        });
      },
    );

  // ── gateway list ───────────────────────────────────────
  program
    .command("gateways")
    .description("List saved gateway targets")
    .action(() => {
      const targets = loadGatewayTargets();
      if (targets.length === 0) {
        console.log("No saved gateway targets.");
        console.log("Use: clawmesh gateway-connect --url <url> --save <name>");
        return;
      }
      for (const t of targets) {
        const auth = t.password ? "password" : t.token ? "token" : "none";
        console.log(`  ${t.name}  ${t.url}  auth=${auth}  role=${t.role ?? "node"}`);
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

  // ── world ─────────────────────────────────────────────────
  program
    .command("world")
    .description("Query the world model (requires running node)")
    .action(() => {
      console.log("World model query requires a running node.");
      console.log("Use: clawmesh start --mock-sensor (and watch logs)");
    });

  return program;
}
