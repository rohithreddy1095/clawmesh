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
import type { MeshStaticPeer, MeshGatewayTarget } from "../mesh/types.mesh.js";
import { loadGatewayTargets, saveGatewayTarget } from "../mesh/gateway-config.js";
import { rawDataToString } from "../infra/ws.js";
import { loadBhoomiContext } from "../agents/farm-context-loader.js";
import type { ThresholdRule } from "../agents/types.js";
import { MeshTUI } from "../tui/mesh-tui.js";
import { CredentialStore } from "../infra/credential-store.js";
import { validateStartupConfig, hasBlockingDiagnostics, formatDiagnostics } from "./startup-validation.js";
import { createGracefulShutdown } from "./graceful-shutdown.js";

function collectOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function loadLocalEnvFiles(): void {
  for (const path of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }
}

async function readSecretFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error("stdin is a TTY; pass the value directly or pipe it with --from-stdin");
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
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
  loadLocalEnvFiles();

  const program = new Command();
  program
    .name("clawmesh")
    .description("ClawMesh — mesh-first AI gateway")
    .version("0.2.0");

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
    .option("--pi-planner", "Enable Pi-powered planner (event-driven, multi-provider)")
    .option("--pi-model <provider/model>", "Model spec (e.g. google/gemini-3.1-pro-preview)", "google/gemini-3.1-pro-preview")
    .option("--thinking <level>", "Thinking level (off|minimal|low|medium|high)", "off")
    .option("--planner-interval <ms>", "Proactive planner check interval (ms)", (v) => Number(v), 60000)
    .option("--sensors", "Shorthand: enable mock sensor")
    .option("--actuators", "Shorthand: enable mock actuator")
    .option("--field-node", "Shorthand: --sensors --actuators")
    .option("--command-center", "Shorthand: --pi-planner")
    .option("--tui", "Launch the interactive terminal dashboard")
    .option("--telegram", "Enable Telegram channel (requires TELEGRAM_BOT_TOKEN env)")
    .option("--telegram-token <token>", "Telegram Bot API token (or set TELEGRAM_BOT_TOKEN)")
    .option("--telegram-chat <chatId>", "Allowed Telegram chat ID (repeatable)", collectOption, [])
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
        piPlanner?: boolean;
        piModel: string;
        thinking: string;
        plannerInterval: number;
        sensors?: boolean;
        actuators?: boolean;
        fieldNode?: boolean;
        commandCenter?: boolean;
        tui?: boolean;
        telegram?: boolean;
        telegramToken?: string;
        telegramChat: string[];
      }) => {
        // Expand shorthand flags
        if (opts.fieldNode) {
          opts.sensors = true;
          opts.actuators = true;
        }
        if (opts.commandCenter) {
          opts.piPlanner = true;
        }
        if (opts.sensors) {
          opts.mockSensor = true;
        }
        if (opts.actuators) {
          opts.mockActuator = true;
        }

        const identity = loadOrCreateDeviceIdentity();
        const staticPeers = opts.peer.map(parsePeerSpec);

        // ── Load credential store and inject API keys into env ──
        const credStore = new CredentialStore();
        const injectedEnvVars = credStore.injectProviderEnvVars();
        if (injectedEnvVars.length > 0) {
          console.log(`Credentials: injected ${injectedEnvVars.join(", ")} from ~/.clawmesh/credentials.json`);
        }

        // Load farm context for the planner
        const farmContext = opts.piPlanner ? loadBhoomiContext() : undefined;

        // Default threshold rules for auto-triggering the planner
        const defaultThresholds: ThresholdRule[] = [
          {
            ruleId: "moisture-critical",
            metric: "moisture",
            belowThreshold: 20,
            cooldownMs: 300_000,
            promptHint: "Soil moisture has dropped below 20% — evaluate irrigation need",
          },
          {
            ruleId: "moisture-low",
            metric: "moisture",
            belowThreshold: 25,
            cooldownMs: 600_000,
            promptHint: "Soil moisture is below 25% — monitor and consider scheduling irrigation",
          },
        ];

        // Mutable log object — TUI will redirect these when active
        const log = {
          info: (msg: string) => console.log(msg),
          warn: (msg: string) => console.warn(msg),
          error: (msg: string) => console.error(msg),
        };

        // Pre-register channel:telegram capability if Telegram is going to be enabled
        const telegramToken = opts.telegramToken || process.env.TELEGRAM_BOT_TOKEN || credStore.getChannelToken("telegram");
        if (opts.telegram || telegramToken) {
          if (!opts.capability.includes("channel:telegram")) {
            opts.capability.push("channel:telegram");
          }
        }

        // ── Pre-flight validation ──────────────────────────
        const diagnostics = validateStartupConfig({
          deviceId: identity.deviceId,
          port: opts.port,
          staticPeers,
          capabilities: opts.capability,
          thresholds: opts.piPlanner ? defaultThresholds : undefined,
          enablePiSession: !!opts.piPlanner,
          modelSpec: opts.piModel,
          hasApiKey: !!(
            process.env.ANTHROPIC_API_KEY ||
            process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
            process.env.OPENAI_API_KEY
          ),
        });

        if (diagnostics.length > 0) {
          console.log("\n" + formatDiagnostics(diagnostics) + "\n");
        }
        if (hasBlockingDiagnostics(diagnostics)) {
          console.error("Cannot start: blocking issues detected. Fix the errors above.");
          process.exit(1);
        }

        const runtime = new MeshNodeRuntime({
          identity,
          host: opts.host,
          port: opts.port,
          displayName: opts.name,
          capabilities: opts.capability,
          staticPeers,
          enableMockActuator: !!opts.mockActuator,
          enablePiSession: !!opts.piPlanner,
          piSessionModelSpec: opts.piModel,
          piSessionThinkingLevel: opts.thinking as any,
          plannerFarmContext: farmContext,
          plannerThresholds: opts.piPlanner ? defaultThresholds : undefined,
          plannerProactiveIntervalMs: opts.plannerInterval,
          onProposalCreated: (proposal) => {
            log.info(`\n[PROPOSAL] ${proposal.approvalLevel} — ${proposal.summary}`);
            log.info(`  Target: ${proposal.targetRef}:${proposal.operation}`);
            log.info(`  Reasoning: ${proposal.reasoning.slice(0, 200)}`);
            log.info(`  Task ID: ${proposal.taskId}`);
            if (proposal.status === "awaiting_approval") {
              log.info(`  → Awaiting human approval. Use: approve ${proposal.taskId.slice(0, 8)}`);
            }
          },
          log,
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
        if (opts.piPlanner) {
          console.log(`Pi Planner: enabled (pi-agent-core)`);
          console.log(`  Model: ${opts.piModel}`);
          console.log(`  Thinking: ${opts.thinking}`);
          console.log(`  Interval: ${opts.plannerInterval}ms`);
          console.log("  Tools: query_world_model, list_mesh_capabilities, execute_mesh_command, propose_task, list_proposals");
          console.log("  Farm context: Bhoomi Natural (loaded from farm/bhoomi/)");
          console.log(`  Thresholds: ${defaultThresholds.length} rules active`);
        }

        // ── Telegram channel ──────────────────────────────
        let telegramChannel: import("../channels/telegram.js").TelegramChannel | null = null;

        if (opts.telegram || opts.telegramToken || process.env.TELEGRAM_BOT_TOKEN || credStore.getChannelToken("telegram")) {
          const token = opts.telegramToken || process.env.TELEGRAM_BOT_TOKEN || credStore.getChannelToken("telegram");
          if (!token) {
            console.error("Telegram enabled but no token provided. Set TELEGRAM_BOT_TOKEN or use --telegram-token.");
            process.exit(1);
          }

          const { TelegramChannel } = await import("../channels/telegram.js");
          const allowedChatIds = opts.telegramChat.map(Number).filter(n => !isNaN(n));

          telegramChannel = new TelegramChannel({
            token,
            runtime,
            allowedChatIds,
            log,
          });

          await telegramChannel.start();
          console.log(`Telegram: enabled (${allowedChatIds.length > 0 ? `${allowedChatIds.length} allowed chats` : "all chats"})`);
        }

        if (staticPeers.length > 0) {
          console.log(`Static peers: ${staticPeers.length}`);
        }
        console.log("Press Ctrl+C to stop.");

        // ── TUI or readline interactive handler ─────────────
        let tui: MeshTUI | null = null;

        if (opts.tui) {
          // Launch interactive terminal dashboard
          tui = new MeshTUI({ runtime });
          // Redirect runtime logs into the TUI
          log.info = tui.log.info;
          log.warn = tui.log.warn;
          log.error = tui.log.error;
          tui.start();
        } else {
          // Fallback: readline-based stdin handler (existing behavior)
          const readline = await import("readline");
          const rl = readline.createInterface({ input: process.stdin, terminal: false });
          rl.on("line", (line: string) => {
            const trimmed = line.trim();
            if (!trimmed) return;

            const [cmd, ...args] = trimmed.split(/\s+/);

            if (cmd === "proposals" || cmd === "p") {
              const piSession = runtime.piSession;
              if (!piSession) { console.log("Pi planner not active."); return; }
              const all = piSession.getProposals();
              if (all.length === 0) { console.log("No proposals."); return; }
              for (const p of all) {
                console.log(`  [${p.taskId.slice(0, 8)}] ${p.status.toUpperCase()} L${p.approvalLevel.slice(1)} — ${p.summary}`);
              }
            } else if (cmd === "approve" || cmd === "a") {
              const piSession = runtime.piSession;
              if (!piSession) { console.log("Pi planner not active."); return; }
              const prefix = args[0];
              if (!prefix) { console.log("Usage: approve <taskId-prefix>"); return; }
              const match = piSession.getProposals({ status: "awaiting_approval" })
                .find(p => p.taskId.startsWith(prefix));
              if (!match) { console.log(`No awaiting proposal matching "${prefix}".`); return; }
              console.log(`Approving: [${match.taskId.slice(0, 8)}] ${match.summary}`);
              piSession.approveProposal(match.taskId, "operator-cli")
                .then(result => {
                  if (result) {
                    console.log(`Approved: [${result.taskId.slice(0, 8)}] — agent will execute`);
                  } else {
                    console.log(`Approval failed (proposal may have changed status).`);
                  }
                })
                .catch(err => console.error(`Approval error: ${err}`));
            } else if (cmd === "reject" || cmd === "r") {
              const piSession = runtime.piSession;
              if (!piSession) { console.log("Pi planner not active."); return; }
              const prefix = args[0];
              if (!prefix) { console.log("Usage: reject <taskId-prefix>"); return; }
              const match = piSession.getProposals({ status: "awaiting_approval" })
                .find(p => p.taskId.startsWith(prefix));
              if (!match) { console.log(`No awaiting proposal matching "${prefix}".`); return; }
              const result = piSession.rejectProposal(match.taskId, "operator-cli");
              if (result) {
                console.log(`Rejected: [${result.taskId.slice(0, 8)}] ${result.summary}`);
              } else {
                console.log(`Reject failed.`);
              }
            } else if (cmd === "world" || cmd === "w") {
              const frames = runtime.worldModel.getRecentFrames(10);
              if (frames.length === 0) { console.log("No recent frames."); return; }
              for (const f of frames) {
                console.log(`  [${f.kind}] ${f.data.metric}=${f.data.value} (${f.sourceDeviceId?.slice(0, 12)})`);
              }
            } else if (cmd === "mode" || cmd === "status" || cmd === "s") {
              const piSession = runtime.piSession;
              if (!piSession) { console.log("Pi planner not active."); return; }
              const mode = piSession.mode;
              const pending = piSession.getProposals({ status: "awaiting_approval" }).length;
              const total = piSession.getProposals().length;
              console.log(`  Mode: ${mode.toUpperCase()}`);
              console.log(`  Proposals: ${pending} awaiting approval, ${total} total`);
              if (mode === "observing") {
                console.log(`  → LLM calls paused. World model still ingesting. Probing periodically.`);
              } else if (mode === "suspended") {
                console.log(`  → All LLM calls stopped (permanent error). Use 'resume' to re-enable.`);
              }
            } else if (cmd === "resume") {
              const piSession = runtime.piSession;
              if (!piSession) { console.log("Pi planner not active."); return; }
              if (piSession.mode === "active") {
                console.log("Already in active mode.");
                return;
              }
              const prevMode = piSession.mode;
              piSession.resume("manual resume via CLI");
              console.log(`Resumed from ${prevMode} → active. LLM calls re-enabled.`);
            } else if (cmd === "help" || cmd === "h") {
              console.log("Commands:");
              console.log("  proposals (p)        — list all proposals");
              console.log("  approve (a) <id>     — approve a proposal by ID prefix");
              console.log("  reject (r) <id>      — reject a proposal by ID prefix");
              console.log("  world (w)            — show recent world model frames");
              console.log("  mode / status (s)    — show current session mode");
              console.log("  resume               — resume from observing/suspended mode");
              console.log("  help (h)             — show this help");
              console.log("  <anything else>      — send as operator intent to Pi");
            } else {
              // Treat as operator intent for Pi
              const piSession = runtime.piSession;
              if (piSession) {
                console.log(`[operator] Sending to Pi: "${trimmed}"`);
                piSession.handleOperatorIntent(trimmed);
              } else {
                console.log(`Unknown command: ${cmd}. Type "help" for commands.`);
              }
            }
          });
        }

        // ── Graceful shutdown (replaces raw signal handler) ──
        const shutdown = createGracefulShutdown(async () => {
          if (tui) tui.stop();
          if (telegramChannel) await telegramChannel.stop().catch(() => {});
          await runtime.stop();
        }, { log, timeoutMs: 15_000 });
        await new Promise<void>(() => {
          // Keep alive — GracefulShutdown handles SIGINT/SIGTERM
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
    .option("--public-key <key>", "Public key for pinning (base64url)")
    .action(async (deviceId: string, opts: { name?: string; publicKey?: string }) => {
      const result = await addTrustedPeer({
        deviceId,
        displayName: opts.name,
        publicKey: opts.publicKey,
      });
      if (result.added) {
        console.log(`Trusted peer added: ${deviceId}`);
        if (opts.publicKey) {
          console.log(`  Public key pinned: ${opts.publicKey.slice(0, 20)}…`);
        } else {
          console.log("  ⚠ No public key pinned — will accept any key on first connect (TOFU)");
        }
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

  // ── credentials ─────────────────────────────────────────
  const cred = program
    .command("credential")
    .alias("cred")
    .description("Manage stored credentials (API keys, tokens)");

  cred
    .command("set <key> [value]")
    .description("Store a credential (e.g. provider/google, channel/telegram)")
    .option("--label <label>", "Human-readable label")
    .option("--from-stdin", "Read the credential value from stdin instead of the command line")
    .action(async (key: string, value: string | undefined, opts: { label?: string; fromStdin?: boolean }) => {
      const secret = opts.fromStdin ? await readSecretFromStdin() : value;
      if (!secret) {
        console.error("Missing credential value. Pass it as an argument or pipe it with --from-stdin.");
        process.exit(1);
      }

      const store = new CredentialStore();
      store.set(key, secret, opts.label);
      const envVar = CredentialStore.envVarForProvider(key.replace("provider/", ""));
      console.log(`Stored: ${key}`);
      if (!opts.fromStdin) {
        console.warn("  Warning: passing secrets as CLI args can leak into shell history. Prefer --from-stdin or env vars.");
      }
      if (key.startsWith("provider/") && envVar) {
        console.log(`  → Will inject as ${envVar} on next 'clawmesh start'`);
      }
      if (key.startsWith("channel/")) {
        console.log(`  → Will be used by '${key.replace("channel/", "")}' channel on next start`);
      }
    });

  cred
    .command("get <key>")
    .description("Show masked credential metadata; use --reveal to print the full value")
    .option("--reveal", "Print the full credential value")
    .action((key: string, opts: { reveal?: boolean }) => {
      const store = new CredentialStore();
      const entry = store.getEntry(key);
      if (!entry) {
        console.log(`Not found: ${key}`);
        return;
      }
      if (opts.reveal) {
        console.warn("Warning: printing secrets to stdout can leak them into logs or terminal history.");
        console.log(entry.value);
        return;
      }
      console.log(`${key}  ${CredentialStore.maskValue(entry.value)}  added ${entry.addedAt.slice(0, 10)}`);
      console.log("Use --reveal only when you explicitly need the raw value.");
    });

  cred
    .command("list")
    .description("List all stored credentials (values masked)")
    .action(() => {
      const store = new CredentialStore();
      const entries = store.list();
      if (entries.length === 0) {
        console.log("No stored credentials.");
        console.log("Use: clawmesh credential set provider/google <api-key>");
        return;
      }
      for (const e of entries) {
        const label = e.label ? ` (${e.label})` : "";
        const envVar = CredentialStore.envVarForProvider(e.key.replace("provider/", ""));
        const envHint = envVar ? ` → ${envVar}` : "";
        console.log(`  ${e.key}${label}  ${e.masked}  added ${e.addedAt.slice(0, 10)}${envHint}`);
      }
    });

  cred
    .command("delete <key>")
    .alias("rm")
    .description("Delete a stored credential")
    .action((key: string) => {
      const store = new CredentialStore();
      if (store.delete(key)) {
        console.log(`Deleted: ${key}`);
      } else {
        console.log(`Not found: ${key}`);
      }
    });

  // ── gateway-connect ─────────────────────────────────────
  program
    .command("gateway-connect [name]")
    .description("Connect to a remote ClawMesh gateway")
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

  // ── info (local identity) ────────────────────────────────
  program
    .command("info")
    .description("Show local device identity and mesh info")
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

  // ── status ──────────────────────────────────────────────
  program
    .command("status")
    .description("Query a running node's health and recent events")
    .option("--url <url>", "WebSocket URL of the node", "ws://localhost:18789")
    .option("--events", "Also show recent system events")
    .action(async (opts: { url: string; events?: boolean }) => {
      const { WebSocket } = await import("ws");

      const ws = new WebSocket(opts.url);
      const timeout = setTimeout(() => {
        console.error(`Timeout connecting to ${opts.url}`);
        ws.close();
        process.exit(1);
      }, 5000);

      ws.on("open", () => {
        clearTimeout(timeout);
        // Send health check RPC
        ws.send(JSON.stringify({
          type: "req", id: "health-1", method: "mesh.health", params: {},
        }));
        if (opts.events) {
          ws.send(JSON.stringify({
            type: "req", id: "events-1", method: "mesh.events", params: { limit: 10 },
          }));
        }
      });

      let responsesReceived = 0;
      const expectedResponses = opts.events ? 2 : 1;

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "res" && msg.ok && msg.id === "health-1") {
            const h = msg.payload;
            console.log(`\n  Status:      ${h.status.toUpperCase()}`);
            console.log(`  Node:        ${h.displayName ?? h.nodeId}`);
            console.log(`  Uptime:      ${Math.round(h.uptimeMs / 60_000)}min`);
            console.log(`  Peers:       ${h.peers.connected}`);
            if (h.peers.details?.length > 0) {
              for (const p of h.peers.details) {
                console.log(`    ${p.displayName ?? p.deviceId} [${p.capabilities.join(",")}]`);
              }
            }
            console.log(`  World model: ${h.worldModel.entries} entries, ${h.worldModel.frameLogSize} frames`);
            console.log(`  Planner:     ${h.plannerMode ?? "disabled"}`);
            console.log(`  Memory:      ${h.memoryUsageMB ?? "?"}MB`);
            console.log(`  Version:     ${h.version}`);
            if (h.metrics?.length > 0) {
              console.log("  Metrics:");
              for (const m of h.metrics) {
                console.log(`    ${m.name}: ${m.value}`);
              }
            }
            console.log("");
          } else if (msg.type === "res" && msg.ok && msg.id === "events-1") {
            const e = msg.payload;
            console.log(`  Recent events (${e.summary.total} in last hour):`);
            for (const ev of e.events.slice(0, 10)) {
              const time = new Date(ev.timestamp).toLocaleTimeString();
              console.log(`    ${time} [${ev.type}] ${ev.message}`);
            }
            console.log("");
          } else if (msg.type === "res" && !msg.ok) {
            console.error(`  RPC error: ${msg.error?.message ?? "unknown"}`);
          }
        } catch { /* ignore parse errors */ }

        responsesReceived++;
        if (responsesReceived >= expectedResponses) {
          ws.close();
        }
      });

      ws.on("close", () => { clearTimeout(timeout); });
      ws.on("error", (err) => {
        clearTimeout(timeout);
        console.error(`Failed to connect to ${opts.url}: ${err.message}`);
        process.exit(1);
      });
    });

  return program;
}
