import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { MeshStaticPeer } from "../mesh/types.mesh.js";
import { rawDataToString } from "../infra/ws.js";
import type { DeviceIdentity } from "../infra/device-identity.js";
import { forwardMessageToPeer } from "./forwarding.js";
import { MeshCapabilityRegistry } from "./capabilities.js";
import { MockActuatorController, createMockActuatorHandlers } from "./mock-actuator.js";
import { MeshPeerClient } from "./peer-client.js";
import { PeerRegistry } from "./peer-registry.js";
import type { ContextFrame } from "./context-types.js";
import { ContextPropagator } from "./context-propagator.js";
import { WorldModel } from "./world-model.js";
import { createMeshServerHandlers } from "./peer-server.js";
import { createMeshForwardHandlers } from "./server-methods/forward.js";
import { createMeshPeersHandlers } from "./server-methods/peers.js";
import { createContextSyncHandlers } from "./server-methods/context-sync.js";
import { createHealthCheckHandlers } from "./health-check.js";
import { MeshEventBus } from "./event-bus.js";
import { evaluateMeshForwardTrust } from "./trust-policy.js";
import type {
  ClawMeshCommandEnvelopeV1,
  MeshForwardPayload,
  MeshForwardTrustMetadata,
} from "./types.js";
import { PiSession } from "../agents/pi-session.js";
import type { FarmContext, ThresholdRule, TaskProposal } from "../agents/types.js";
import { MeshDiscovery } from "./discovery.js";

type RpcRequestFrame = {
  type: "req";
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

type RpcResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code?: string; message?: string } | null;
};

type HandlerFn = (opts: {
  req: Record<string, unknown>;
  params: Record<string, unknown>;
  respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void;
  client?: unknown;
  isWebchatConnect?: () => boolean;
  context?: unknown;
}) => void | Promise<void>;
type GatewayRequestHandlers = Record<string, HandlerFn>;

export type MeshNodeRuntimeOptions = {
  identity: DeviceIdentity;
  host?: string;
  port?: number;
  displayName?: string;
  capabilities?: string[];
  staticPeers?: MeshStaticPeer[];
  enableMockActuator?: boolean;
  /** Enable Pi-powered planner (uses @mariozechner/pi-agent-core). */
  enablePiSession?: boolean;
  /** Provider/model spec for Pi planner (e.g. "anthropic/claude-sonnet-4-5-20250929"). */
  piSessionModelSpec?: string;
  /** Thinking level for Pi planner. */
  piSessionThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
  /** Farm context for the planner system prompt. */
  plannerFarmContext?: FarmContext;
  /** Threshold rules that trigger the planner automatically. */
  plannerThresholds?: ThresholdRule[];
  /** How often the planner proactively checks state (ms). 0 = disabled. */
  plannerProactiveIntervalMs?: number;
  /** Callback when planner creates a proposal. */
  onProposalCreated?: (proposal: TaskProposal) => void;
  /** Callback when planner resolves a proposal. */
  onProposalResolved?: (proposal: TaskProposal) => void;
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};

export type SendMockActuationParams = {
  peerDeviceId: string;
  targetRef: string;
  operation: string;
  operationParams?: Record<string, unknown>;
  note?: string;
  trust?: MeshForwardTrustMetadata;
};

const DEFAULT_LOGGER: NonNullable<MeshNodeRuntimeOptions["log"]> = {
  info: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
  error: (msg) => console.error(msg),
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultActuationTrust(): MeshForwardTrustMetadata {
  return {
    action_type: "actuation",
    evidence_sources: ["sensor", "human"],
    evidence_trust_tier: "T3_verified_action_evidence",
    minimum_trust_tier: "T2_operational_observation",
    verification_required: "human",
    verification_satisfied: true,
    approved_by: ["operator:local-cli"],
  };
}

export class MeshNodeRuntime {
  readonly identity: DeviceIdentity;
  readonly peerRegistry = new PeerRegistry();
  readonly capabilityRegistry = new MeshCapabilityRegistry();
  readonly contextPropagator: ContextPropagator;
  readonly worldModel: WorldModel;
  readonly eventBus: MeshEventBus;
  readonly mockActuator?: MockActuatorController;
  readonly discovery?: MeshDiscovery;
  readonly piSession?: PiSession;
  readonly startedAtMs: number = Date.now();

  private readonly opts: MeshNodeRuntimeOptions;
  private readonly host: string;
  private readonly requestedPort: number;
  readonly displayName?: string;
  private readonly capabilities: string[];
  private readonly staticPeers: MeshStaticPeer[];
  private readonly log: Required<MeshNodeRuntimeOptions>["log"];
  private readonly handlers: GatewayRequestHandlers;

  private readonly outboundClients = new Map<string, MeshPeerClient>();
  private readonly inboundSocketConnIds = new Map<WebSocket, string>();
  private readonly uiSubscribers = new Set<WebSocket>();
  private wss: WebSocketServer | null = null;
  constructor(opts: MeshNodeRuntimeOptions) {
    this.opts = opts;
    this.identity = opts.identity;
    this.host = opts.host ?? "0.0.0.0";
    this.requestedPort = opts.port ?? 18789;
    this.displayName = opts.displayName;
    this.capabilities = [...(opts.capabilities ?? [])];
    this.staticPeers = [...(opts.staticPeers ?? [])];
    this.log = opts.log ?? DEFAULT_LOGGER;

    if (opts.enableMockActuator) {
      this.mockActuator = new MockActuatorController({ log: this.log });
      if (!this.capabilities.includes("channel:clawmesh")) {
        this.capabilities.push("channel:clawmesh");
      }
      if (!this.capabilities.includes("actuator:mock")) {
        this.capabilities.push("actuator:mock");
      }
    }

    this.eventBus = new MeshEventBus();

    this.contextPropagator = new ContextPropagator({
      identity: this.identity,
      peerRegistry: this.peerRegistry,
      displayName: this.displayName,
      log: this.log,
    });

    this.worldModel = new WorldModel({
      maxHistory: 1000,
      log: this.log,
    });

    // Wire locally-originated frames into the world model + event bus
    this.contextPropagator.onLocalBroadcast = (frame) => {
      this.worldModel.ingest(frame);
      this.eventBus.emit("context.frame.broadcast", { frame });
    };

    const sharedHandlers: GatewayRequestHandlers = {
      ...createMeshServerHandlers({
        identity: this.identity,
        peerRegistry: this.peerRegistry,
        displayName: this.displayName,
        capabilities: this.capabilities,
        onPeerConnected: (session) => {
          if (session.capabilities.length > 0) {
            this.capabilityRegistry.updatePeer(session.deviceId, session.capabilities);
          }
          this.eventBus.emit("peer.connected", { session });
        },
      }),
      ...createMeshPeersHandlers({
        peerRegistry: this.peerRegistry,
        capabilityRegistry: this.capabilityRegistry,
        localDeviceId: this.identity.deviceId,
      }),
      ...createMeshForwardHandlers({
        identity: this.identity,
        onForward: async (payload) => {
          if (this.mockActuator) {
            await this.mockActuator.handleForward(payload);
          }
        },
      }),
    };

    if (this.mockActuator) {
      Object.assign(
        sharedHandlers,
        createMockActuatorHandlers({
          controller: this.mockActuator,
        }),
      );
    }

    // ─── Context Sync & Health Check handlers ───────────────
    Object.assign(
      sharedHandlers,
      createContextSyncHandlers({ worldModel: this.worldModel }),
      createHealthCheckHandlers({
        nodeId: this.identity.deviceId,
        displayName: this.displayName,
        startedAtMs: this.startedAtMs,
        version: "0.2.0",
        localCapabilities: this.capabilities,
        peerRegistry: this.peerRegistry,
        capabilityRegistry: this.capabilityRegistry,
        worldModel: this.worldModel,
        getPlannerMode: () => this.piSession?.mode,
      }),
    );

    // ─── Chat & UI subscriber handlers ─────────────────────
    sharedHandlers["chat.subscribe"] = ({ req, respond }) => {
      const socket = (req as any)._socket as WebSocket | undefined;
      if (socket) {
        this.uiSubscribers.add(socket);
        socket.addEventListener("close", () => {
          this.uiSubscribers.delete(socket);
        });
        this.log.info("mesh: UI client subscribed to chat");
      }
      respond(true, { subscribed: true });
    };

    sharedHandlers["chat.proposal.approve"] = async ({ params, respond }) => {
      const taskId = params.taskId as string;
      if (!taskId) {
        respond(false, undefined, { code: "INVALID_PARAMS", message: "taskId required" });
        return;
      }
      if (!this.piSession) {
        respond(false, undefined, { code: "NO_PLANNER", message: "Pi planner not active" });
        return;
      }
      const proposal = await this.piSession.approveProposal(taskId);
      if (proposal) {
        respond(true, { proposal });
      } else {
        respond(false, undefined, { code: "NOT_FOUND", message: "Proposal not found or not awaiting approval" });
      }
    };

    sharedHandlers["chat.proposal.reject"] = ({ params, respond }) => {
      const taskId = params.taskId as string;
      if (!taskId) {
        respond(false, undefined, { code: "INVALID_PARAMS", message: "taskId required" });
        return;
      }
      if (!this.piSession) {
        respond(false, undefined, { code: "NO_PLANNER", message: "Pi planner not active" });
        return;
      }
      const proposal = this.piSession.rejectProposal(taskId);
      if (proposal) {
        respond(true, { proposal });
      } else {
        respond(false, undefined, { code: "NOT_FOUND", message: "Proposal not found or not awaiting approval" });
      }
    };

    this.handlers = sharedHandlers;
  }

  /**
   * Send an event to all UI WebSocket subscribers (browsers that called chat.subscribe).
   */
  broadcastToUI(event: string, payload: unknown): void {
    const msg = JSON.stringify({ type: "event", event, payload });
    for (const ws of this.uiSubscribers) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  async start(): Promise<{ host: string; port: number }> {
    if (this.wss) {
      return this.listenAddress();
    }

    this.wss = await new Promise<WebSocketServer>((resolve, reject) => {
      const server = new WebSocketServer({
        host: this.host,
        port: this.requestedPort,
        maxPayload: 10 * 1024 * 1024,
      });
      const onError = (err: Error) => {
        server.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(server);
      };
      server.once("error", onError);
      server.once("listening", onListening);
    });

    this.wss.on("connection", (socket) => {
      const connId = randomUUID();
      this.inboundSocketConnIds.set(socket, connId);

      socket.on("message", (raw) => {
        void this.handleInboundMessage(socket, connId, rawDataToString(raw));
      });

      socket.on("close", () => {
        this.inboundSocketConnIds.delete(socket);
        this.uiSubscribers.delete(socket);
        const deviceId = this.peerRegistry.unregister(connId);
        if (deviceId) {
          this.capabilityRegistry.removePeer(deviceId);
          this.log.info(`mesh: inbound peer disconnected ${deviceId.slice(0, 12)}…`);
        }
      });

      socket.on("error", (err) => {
        this.log.warn(`mesh: inbound socket error: ${String(err)}`);
      });
    });

    this.log.info(
      `mesh: listening on ws://${this.host}:${this.listenAddress().port} (deviceId=${this.identity.deviceId.slice(0, 12)}…)`,
    );

    // Start mDNS discovery (best-effort — not all platforms support it)
    try {
      (this as any).discovery = new MeshDiscovery({
        localDeviceId: this.identity.deviceId,
        localPort: this.listenAddress().port,
        displayName: this.displayName,
      });
      this.discovery?.start();
      this.discovery?.on("peer-discovered", (peer) => {
        this.log.info(`mesh: discovered peer ${peer.deviceId.slice(0, 12)}… via mDNS`);
      });
    } catch (err) {
      this.log.warn(`mesh: mDNS discovery unavailable (${err}). Using static peers only.`);
    }

    for (const peer of this.staticPeers) {
      this.connectToPeer(peer);
    }

    // Start Pi planner if enabled
    if (this.opts.enablePiSession) {
      this.startPiSessionLoop();
    }

    return this.listenAddress();
  }

  async stop(): Promise<void> {
    // Stop planner
    if (this.piSession) {
      this.piSession.stop();
      this.log.info("mesh: pi-planner stopped");
    }

    if (this.discovery) {
      this.discovery.stop();
    }

    for (const client of this.outboundClients.values()) {
      client.stop();
    }
    this.outboundClients.clear();

    for (const socket of this.inboundSocketConnIds.keys()) {
      try {
        socket.close();
      } catch {
        // ignore close failures
      }
    }
    this.inboundSocketConnIds.clear();

    const wss = this.wss;
    this.wss = null;
    if (wss) {
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    }
  }

  private startPiSessionLoop(): void {
    const session = new PiSession({
      runtime: this,
      modelSpec: this.opts.piSessionModelSpec ?? "anthropic/claude-sonnet-4-5-20250929",
      thinkingLevel: this.opts.piSessionThinkingLevel ?? "off",
      farmContext: this.opts.plannerFarmContext,
      thresholds: this.opts.plannerThresholds,
      proactiveIntervalMs: this.opts.plannerProactiveIntervalMs ?? 60_000,
      onProposalCreated: (proposal) => {
        this.peerRegistry.broadcastEvent("planner.proposal", proposal);
        this.broadcastToUI("planner.proposal", proposal);
        this.opts.onProposalCreated?.(proposal);
      },
      onProposalResolved: (proposal) => {
        this.peerRegistry.broadcastEvent("planner.proposal.resolved", proposal);
        this.broadcastToUI("planner.proposal.resolved", proposal);
        this.opts.onProposalResolved?.(proposal);
      },
      onModeChange: (mode, reason) => {
        this.log.info(`[pi-mode] ${mode.toUpperCase()} — ${reason}`);
      },
      log: this.log,
    });

    (this as any).piSession = session;

    // PiSession.start() is async (creates AgentSession)
    session.start().then(() => {
      this.log.info("mesh: pi-session started (createAgentSession SDK)");
    }).catch((err) => {
      this.log.error(`mesh: pi-session failed to start: ${err}`);
    });
  }

  listenAddress(): { host: string; port: number } {
    if (!this.wss) {
      return { host: this.host, port: this.requestedPort };
    }
    const addr = this.wss.address();
    if (typeof addr === "string" || !addr) {
      return { host: this.host, port: this.requestedPort };
    }
    const parsed = addr as AddressInfo;
    return {
      host: parsed.address,
      port: parsed.port,
    };
  }

  connectToPeer(peer: MeshStaticPeer): void {
    if (this.outboundClients.has(peer.deviceId)) {
      return;
    }

    const client = new MeshPeerClient({
      url: peer.url,
      remoteDeviceId: peer.deviceId,
      identity: this.identity,
      peerRegistry: this.peerRegistry,
      tlsFingerprint: peer.tlsFingerprint,
      displayName: this.displayName,
      capabilities: this.capabilities,
      onConnected: (session) => {
        if (session.capabilities.length > 0) {
          this.capabilityRegistry.updatePeer(session.deviceId, session.capabilities);
        }
        this.log.info(`mesh: outbound connected ${session.deviceId.slice(0, 12)}…`);
      },
      onDisconnected: (deviceId) => {
        this.capabilityRegistry.removePeer(deviceId);
        this.log.info(`mesh: outbound disconnected ${deviceId.slice(0, 12)}…`);
      },
      onError: (err) => {
        this.log.warn(`mesh: outbound peer error (${peer.deviceId.slice(0, 12)}…): ${String(err)}`);
      },
      onEvent: (event, payload) => {
        if (event === "context.frame") {
          const frame = payload as ContextFrame;
          const isNew = this.contextPropagator.handleInbound(frame, peer.deviceId);
          if (isNew) {
            this.worldModel.ingest(frame);
            this.eventBus.emit("context.frame.ingested", { frame });
          }
        }
      },
    });
    this.outboundClients.set(peer.deviceId, client);
    client.start();
  }

  async waitForPeerConnected(deviceId: string, timeoutMs: number = 10_000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.peerRegistry.get(deviceId)) {
        return true;
      }
      await delay(50);
    }
    return false;
  }

  listConnectedPeers() {
    return this.peerRegistry.listConnected();
  }

  getAdvertisedCapabilities(): string[] {
    return [...this.capabilities];
  }

  async sendMockActuation(params: SendMockActuationParams) {
    // If the caller provides explicit trust metadata, use it as-is.
    // Only apply the safe defaults when no trust is specified.
    const trust = (params.trust ?? defaultActuationTrust()) as ClawMeshCommandEnvelopeV1["trust"];

    // Sender-side trust evaluation: reject before transmitting over the wire.
    // This catches policy violations early (e.g. LLM-only actuation) rather than
    // letting the receiver reject after a round-trip.
    const senderPayload: MeshForwardPayload = {
      channel: "clawmesh",
      to: params.targetRef,
      originGatewayId: this.identity.deviceId,
      idempotencyKey: "",
      trust,
    };
    const trustDecision = evaluateMeshForwardTrust(senderPayload);
    if (!trustDecision.ok) {
      this.log.warn(
        `mesh: sender-side trust rejection: ${trustDecision.code} — ${trustDecision.message}`,
      );
      return {
        ok: false,
        error: `trust policy: ${trustDecision.code} — ${trustDecision.message}`,
      };
    }

    return await forwardMessageToPeer({
      peerRegistry: this.peerRegistry,
      peerDeviceId: params.peerDeviceId,
      channel: "clawmesh",
      to: params.targetRef,
      message: params.note,
      originGatewayId: this.identity.deviceId,
      commandDraft: {
        source: {
          nodeId: this.identity.deviceId,
          role: "planner",
        },
        target: {
          kind: "capability",
          ref: params.targetRef,
        },
        operation: {
          name: params.operation,
          params: params.operationParams,
        },
        trust,
        note: params.note,
      },
    });
  }

  async queryPeerMockActuatorState(params: {
    peerDeviceId: string;
    targetRef?: string;
    timeoutMs?: number;
  }): Promise<{
    ok: boolean;
    payload?: unknown;
    error?: { code?: string; message?: string } | null;
  }> {
    return await this.peerRegistry.invoke({
      deviceId: params.peerDeviceId,
      method: "clawmesh.mock.actuator.state",
      params: params.targetRef ? { targetRef: params.targetRef } : {},
      timeoutMs: params.timeoutMs ?? 10_000,
    });
  }

  private async handleInboundMessage(socket: WebSocket, connId: string, raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== "object") {
      return;
    }

    const frame = parsed as Record<string, unknown>;

    // Handle context.frame events from peers
    if (frame.type === "event" && frame.event === "context.frame") {
      const contextFrame = frame.payload as ContextFrame;
      const senderSession = this.peerRegistry.getByConnId(connId);
      const fromDeviceId = senderSession?.deviceId ?? contextFrame.sourceDeviceId;
      const isNew = this.contextPropagator.handleInbound(contextFrame, fromDeviceId);
      if (isNew) {
        this.worldModel.ingest(contextFrame);
        this.eventBus.emit("context.frame.ingested", { frame: contextFrame });
      }
      return;
    }

    // --- INTELLIGENCE HANDLER: route operator intents to planner ---
    if (frame.type === "req" && frame.method === "mesh.message.forward") {
      const fwdParams = (frame.params ?? {}) as Record<string, unknown>;

      // If targeting agent:pi, route to the planner loop (if active) or mock fallback
      if (fwdParams.to === "agent:pi" && fwdParams.channel === "clawmesh") {
        const cmd = fwdParams.commandDraft as Record<string, unknown> | undefined;
        const operation = cmd?.operation as Record<string, unknown> | undefined;
        if (operation?.name === "intent:parse") {
          const intentText = (operation.params as Record<string, unknown>)?.text ?? "Unknown intent";
          const conversationId = ((operation.params as Record<string, unknown>)?.conversationId as string) || randomUUID();
          const requestId = randomUUID();

          // Route to Pi planner if available, otherwise mock fallback
          if (this.piSession) {
            this.log.info(`[pi-planner] Operator intent: "${intentText}" (conv=${conversationId.slice(0, 8)})`);

            this.contextPropagator.broadcastHumanInput({
              data: { intent: intentText, conversationId, requestId },
              note: `Operator submitted intent via UI`,
            });

            this.piSession.handleOperatorIntent(String(intentText), { conversationId, requestId });
          } else {
            // Fallback: mock handler for UI testing without LLM
            this.log.info(`[mock-pi] Received natural language intent: "${intentText}"`);

            this.contextPropagator.broadcastHumanInput({
              data: { intent: intentText, conversationId, requestId },
              note: `Operator submitted intent`,
            });

            // Send thinking status to UI
            this.broadcastToUI("context.frame", {
              kind: "agent_response",
              frameId: randomUUID(),
              sourceDeviceId: this.identity.deviceId,
              sourceDisplayName: this.displayName,
              timestamp: Date.now(),
              data: { conversationId, requestId, message: "", status: "thinking" },
              trust: { evidence_sources: ["llm"], evidence_trust_tier: "T0_planning_inference" },
            });

            setTimeout(() => {
              const responseFrame = {
                kind: "agent_response" as const,
                frameId: randomUUID(),
                sourceDeviceId: this.identity.deviceId,
                sourceDisplayName: this.displayName,
                timestamp: Date.now(),
                data: {
                  conversationId,
                  requestId,
                  message: `I received your intent: "${intentText}". This is a simulated response — enable the Pi planner (--pi-planner) for real intelligence.`,
                  status: "complete",
                },
                trust: { evidence_sources: ["llm" as const], evidence_trust_tier: "T0_planning_inference" as const },
              };
              this.broadcastToUI("context.frame", responseFrame);
              this.log.info(`[mock-pi] Broadcasted mock agent_response for intent.`);
            }, 2000);
          }
        }
      }
    }
    // ------------------------------------------------

    if (!("type" in frame)) {
      return;
    }

    if (frame.type === "res") {
      if (typeof frame.id !== "string" || typeof frame.ok !== "boolean") {
        return;
      }
      this.peerRegistry.handleRpcResult({
        id: frame.id,
        ok: frame.ok,
        payload: frame.payload,
        error:
          frame.error && typeof frame.error === "object"
            ? (frame.error as { code?: string; message?: string })
            : null,
      });
      return;
    }

    if (frame.type !== "req") {
      return;
    }
    if (typeof frame.id !== "string" || typeof frame.method !== "string") {
      return;
    }

    await this.dispatchRpcRequest(socket, connId, {
      type: "req",
      id: frame.id,
      method: frame.method,
      params:
        frame.params && typeof frame.params === "object"
          ? (frame.params as Record<string, unknown>)
          : {},
    });
  }

  private async dispatchRpcRequest(
    socket: WebSocket,
    connId: string,
    frame: RpcRequestFrame,
  ): Promise<void> {
    const respond = (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }
      const response: RpcResponseFrame = {
        type: "res",
        id: frame.id,
        ok,
        payload,
        error,
      };
      socket.send(JSON.stringify(response));
    };

    const handler = this.handlers[frame.method];
    if (!handler) {
      respond(false, undefined, {
        code: "UNKNOWN_METHOD",
        message: `unknown method: ${frame.method}`,
      });
      return;
    }

    try {
      await handler({
        req: {
          id: frame.id,
          method: frame.method,
          params: frame.params ?? {},
          _connId: connId,
          _socket: socket,
        },
        params: frame.params ?? {},
        client: null,
        isWebchatConnect: () => false,
        context: {},
        respond,
      });
    } catch (err) {
      respond(false, undefined, {
        code: "INTERNAL_ERROR",
        message: String(err),
      });
    }
  }
}

export function buildLlmOnlyActuationTrust(): MeshForwardPayload["trust"] {
  return {
    action_type: "actuation",
    evidence_sources: ["llm"],
    evidence_trust_tier: "T3_verified_action_evidence",
    minimum_trust_tier: "T2_operational_observation",
    verification_required: "none",
  };
}
