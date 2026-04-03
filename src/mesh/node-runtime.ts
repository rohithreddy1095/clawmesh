import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { MeshStaticPeer } from "../mesh/types.mesh.js";
import { rawDataToString } from "../infra/ws.js";
import type { DeviceIdentity } from "../infra/device-identity.js";
import { MeshCapabilityRegistry } from "./capabilities.js";
import { MockActuatorController, createMockActuatorHandlers } from "./mock-actuator.js";
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
import { RpcDispatcher } from "./rpc-dispatcher.js";
import { UIBroadcaster } from "./ui-broadcaster.js";
import { extractIntentFromForward, routeIntent } from "./intent-router.js";
import { routeInboundMessage } from "./message-router.js";
import { AutoConnectManager } from "./auto-connect.js";
import { TrustAuditTrail } from "./trust-audit.js";
import { sendActuation } from "./actuation-sender.js";
import { PeerConnectionManager } from "./peer-connection-manager.js";
import { createChatHandlers } from "./chat-handlers.js";
import { handleInboundDisconnect } from "./inbound-connection.js";
import { RateLimiter } from "./rate-limiter.js";
import { validateMessageSize } from "./message-validation.js";
import { MetricsCollector, MESH_METRICS } from "./metrics-collector.js";
import { SystemEventLog } from "./system-event-log.js";
import { wireEventLog, wireCorrelationTracker, restoreWorldModelSnapshot, saveWorldModelSnapshot } from "./runtime-setup-helpers.js";
import { CorrelationTracker } from "./correlation-tracker.js";
import { createEventsHandlers } from "./events-rpc.js";
import { createTraceHandlers } from "./trace-rpc.js";
import type {
  ClawMeshCommandEnvelopeV1,
  MeshForwardPayload,
  MeshForwardTrustMetadata,
  MeshNodeRole,
} from "./types.js";
import { PiSession } from "../agents/pi-session.js";
import { createAndStartPiSession } from "./pi-session-factory.js";
import type { FarmContext, ThresholdRule, TaskProposal } from "../agents/types.js";
import { formatProposalOwner } from "../agents/proposal-formatting.js";
import { MeshDiscovery } from "./discovery.js";
import { loadOrCreateMeshId } from "./mesh-identity.js";
import { NODE_PROTOCOL_GENERATION } from "./protocol.js";
import { choosePlannerLeader, getPlannerActivity, type PlannerActivity, type PlannerLeader } from "./planner-election.js";

export type MeshNodeRuntimeOptions = {
  identity: DeviceIdentity;
  host?: string;
  port?: number;
  displayName?: string;
  meshId?: string;
  meshName?: string;
  role?: MeshNodeRole;
  disableDiscovery?: boolean;
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
  readonly meshId: string;
  readonly role: MeshNodeRole;
  private readonly capabilities: string[];
  private readonly staticPeers: MeshStaticPeer[];
  private readonly log: Required<MeshNodeRuntimeOptions>["log"];
  readonly rpcDispatcher: RpcDispatcher;
  readonly peerConnections: PeerConnectionManager;
  private readonly inboundSocketConnIds = new Map<WebSocket, string>();
  /** Rate limiter for inbound RPC requests (100 req/min per connection). */
  private readonly inboundRateLimiter = new RateLimiter({ maxRequests: 100, windowMs: 60_000 });
  /** Operational metrics for monitoring/health. */
  readonly metrics = new MetricsCollector();
  /** Structured event log for debugging. */
  readonly eventLog = new SystemEventLog();
  /** Causal chain tracer for "why did X happen?" debugging. */
  readonly correlationTracker = new CorrelationTracker();
  readonly uiBroadcaster = new UIBroadcaster();
  readonly autoConnect = new AutoConnectManager();
  readonly trustAudit = new TrustAuditTrail();
  private wss: WebSocketServer | null = null;
  constructor(opts: MeshNodeRuntimeOptions) {
    this.opts = opts;
    this.identity = opts.identity;
    this.host = opts.host ?? "0.0.0.0";
    this.requestedPort = opts.port ?? 18789;
    this.displayName = opts.displayName;
    this.role = opts.role ?? "node";
    this.meshId = opts.meshId ?? loadOrCreateMeshId({
      meshName: opts.meshName,
      originatorDeviceId: this.identity.deviceId,
    });
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
    wireEventLog(this.eventBus, this.eventLog);
    wireCorrelationTracker(this.eventBus, this.correlationTracker);
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
    this.contextPropagator.onLocalBroadcast = (frame) => {
      this.worldModel.ingest(frame);
      this.eventBus.emit("context.frame.broadcast", { frame });
    };
    this.peerConnections = new PeerConnectionManager({
      identity: this.identity,
      displayName: this.displayName,
      capabilities: this.capabilities,
      meshId: this.meshId,
      role: this.role,
      peerRegistry: this.peerRegistry,
      capabilityRegistry: this.capabilityRegistry,
      contextPropagator: this.contextPropagator,
      worldModel: this.worldModel,
      eventBus: this.eventBus,
      autoConnect: this.autoConnect,
      confirmPeerReachable: async (deviceId: string) => {
        const result = await this.peerRegistry.invoke({
          deviceId,
          method: "mesh.health",
          params: {},
          timeoutMs: 3_000,
        });
        return result.ok;
      },
      log: this.log,
    });
    this.rpcDispatcher = new RpcDispatcher();
    this.rpcDispatcher.registerAll(createMeshServerHandlers({
      identity: this.identity,
      peerRegistry: this.peerRegistry,
      displayName: this.displayName,
      capabilities: this.capabilities,
      meshId: this.meshId,
      role: this.role,
      onPeerConnected: (session) => {
        if (session.role !== "viewer" && session.capabilities.length > 0) {
          this.capabilityRegistry.updatePeer(session.deviceId, session.capabilities);
        }
        this.eventBus.emit("peer.connected", { session });
      },
    }));
    this.rpcDispatcher.registerAll(createMeshPeersHandlers({
      peerRegistry: this.peerRegistry,
      capabilityRegistry: this.capabilityRegistry,
      localDeviceId: this.identity.deviceId,
      getPlannerActivity: () => this.getPlannerActivity(),
      isDiscoveryEnabled: () => !this.opts.disableDiscovery,
      getPendingProposals: () => this.getPendingProposalSummaries(),
    }));
    this.rpcDispatcher.registerAll(createMeshForwardHandlers({
      identity: this.identity,
      onForward: async (payload) => {
        if (this.mockActuator) {
          await this.mockActuator.handleForward(payload);
        }
      },
    }));

    if (this.mockActuator) {
      this.rpcDispatcher.registerAll(createMockActuatorHandlers({
        controller: this.mockActuator,
      }));
    }

    this.rpcDispatcher.registerAll(createContextSyncHandlers({ worldModel: this.worldModel }));
    this.rpcDispatcher.registerAll(createHealthCheckHandlers({
      nodeId: this.identity.deviceId,
      displayName: this.displayName,
      startedAtMs: this.startedAtMs,
      version: "0.2.0",
      localCapabilities: this.capabilities,
      peerRegistry: this.peerRegistry,
      capabilityRegistry: this.capabilityRegistry,
      worldModel: this.worldModel,
      getPlannerMode: () => this.piSession?.mode,
      getPlannerLeader: () => this.getPlannerLeader(),
      getPlannerActivity: () => this.getPlannerActivity(),
      isDiscoveryEnabled: () => !this.opts.disableDiscovery,
      getMetrics: () => this.metrics.snapshot(),
    }));
    this.rpcDispatcher.registerAll(createChatHandlers({
      uiBroadcaster: this.uiBroadcaster,
      getPiSession: () => this.piSession,
      log: this.log,
    }));
    this.rpcDispatcher.registerAll(createEventsHandlers({
      eventLog: this.eventLog,
    }));
    this.rpcDispatcher.registerAll(createTraceHandlers({
      correlationTracker: this.correlationTracker,
    }));
  }

  /**
   * Send an event to all UI WebSocket subscribers (browsers that called chat.subscribe).
   */
  broadcastToUI(event: string, payload: unknown): void {
    this.uiBroadcaster.broadcast(event, payload);
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
        this.metrics.inc(MESH_METRICS.INBOUND_MESSAGES);
        if (!this.inboundRateLimiter.allow(connId)) {
          this.metrics.inc(MESH_METRICS.INBOUND_RATE_LIMITED);
          this.log.warn(`mesh: rate-limited inbound connection ${connId.slice(0, 8)}…`);
          return;
        }
        void this.handleInboundMessage(socket, connId, rawDataToString(raw));
      });

      socket.on("close", () => {
        this.inboundRateLimiter.reset(connId);
        this.inboundSocketConnIds.delete(socket);
        this.uiBroadcaster.removeSubscriber(socket);
        handleInboundDisconnect(connId, {
          peerRegistry: this.peerRegistry,
          capabilityRegistry: this.capabilityRegistry,
          eventBus: this.eventBus,
          log: this.log,
        });
      });

      socket.on("error", (err) => {
        this.log.warn(`mesh: inbound socket error: ${String(err)}`);
      });
    });

    // Restore world model from snapshot if available
    const snapshotPath = `${process.env.HOME ?? "."}/.clawmesh/world-model-snapshot.json`;
    restoreWorldModelSnapshot(this.worldModel, snapshotPath, 3_600_000, this.log);

    const addr = this.listenAddress();
    this.log.info(
      `mesh: listening on ws://${this.host}:${addr.port} (deviceId=${this.identity.deviceId.slice(0, 12)}…)`,
    );
    this.eventBus.emit("runtime.started", { host: this.host, port: addr.port });
    this.eventLog.record("startup", `Listening on ws://${this.host}:${addr.port}`, {
      deviceId: this.identity.deviceId.slice(0, 12),
      peers: this.staticPeers.length,
    });

    if (!this.opts.disableDiscovery) {
      try {
        (this as any).discovery = new MeshDiscovery({
          localDeviceId: this.identity.deviceId,
          localPort: this.listenAddress().port,
          displayName: this.displayName,
        });
        this.discovery?.start();
        this.discovery?.on("peer-discovered", (peer) => {
          this.log.info(`mesh: discovered peer ${peer.deviceId.slice(0, 12)}… via mDNS`);
          void this.autoConnect.evaluateWithTrust(peer).then((decision) => {
            if (decision.action === "connect") {
              this.log.info(`mesh: auto-connecting to trusted peer ${peer.deviceId.slice(0, 12)}… at ${decision.url}`);
              this.connectToPeer({ deviceId: peer.deviceId, url: decision.url });
            }
          }).catch((err) => {
            this.log.warn(`mesh: auto-connect evaluation failed for ${peer.deviceId.slice(0, 12)}…: ${String(err)}`);
          });
        });
      } catch (err) {
        this.log.warn(`mesh: mDNS discovery unavailable (${err}). Using static peers only.`);
      }
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
    this.eventBus.emit("runtime.stopping", {});
    this.eventLog.record("shutdown", "Shutting down", {
      uptime: Date.now() - this.startedAtMs,
      peers: this.peerRegistry.listConnected().length,
    });

    // Tell peers we are leaving before sockets close so they can clean up immediately.
    this.peerRegistry.broadcastEvent("peer.leaving", {
      gen: NODE_PROTOCOL_GENERATION,
      deviceId: this.identity.deviceId,
      timestamp: Date.now(),
    });

    // Save world model snapshot for fast restart
    saveWorldModelSnapshot(
      this.worldModel, this.identity.deviceId,
      `${process.env.HOME ?? "."}/.clawmesh/world-model-snapshot.json`,
      100, this.log,
    );

    // Stop planner
    if (this.piSession) {
      this.piSession.stop();
      this.log.info("mesh: pi-planner stopped");
    }

    if (this.discovery) {
      this.discovery.stop();
    }

    this.peerConnections.stopAll();

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
    const session = createAndStartPiSession({
      runtime: this,
      modelSpec: this.opts.piSessionModelSpec,
      thinkingLevel: this.opts.piSessionThinkingLevel,
      farmContext: this.opts.plannerFarmContext,
      thresholds: this.opts.plannerThresholds,
      proactiveIntervalMs: this.opts.plannerProactiveIntervalMs,
      onProposalCreated: this.opts.onProposalCreated,
      onProposalResolved: this.opts.onProposalResolved,
      log: this.log,
    });
    (this as any).piSession = session;
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
    this.peerConnections.connectToPeer(peer);
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

  getPlannerLeader(): PlannerLeader {
    return choosePlannerLeader({
      self: { deviceId: this.identity.deviceId, role: this.role },
      peers: this.peerRegistry.listConnected().map((peer) => ({
        deviceId: peer.deviceId,
        role: peer.role,
      })),
    });
  }

  getPlannerActivity(): PlannerActivity {
    return getPlannerActivity({
      self: { deviceId: this.identity.deviceId, role: this.role },
      peers: this.peerRegistry.listConnected().map((peer) => ({
        deviceId: peer.deviceId,
        role: peer.role,
      })),
    });
  }

  shouldHandleAutonomousPlanner(): boolean {
    return this.getPlannerActivity().shouldHandleAutonomous;
  }

  getPendingProposalSummaries() {
    return (this.piSession?.getProposals() ?? [])
      .filter((proposal) => proposal.status === "proposed" || proposal.status === "awaiting_approval")
      .map((proposal) => ({
        taskId: `${proposal.taskId.slice(0, 8)}...`,
        summary: proposal.summary,
        approvalLevel: proposal.approvalLevel,
        status: proposal.status,
        plannerDeviceId: proposal.plannerDeviceId,
        plannerRole: proposal.plannerRole,
        plannerOwner: formatProposalOwner(proposal),
      }));
  }

  getAdvertisedCapabilities(): string[] {
    return [...this.capabilities];
  }

  async sendMockActuation(params: SendMockActuationParams) {
    return await sendActuation(params, {
      peerRegistry: this.peerRegistry,
      deviceId: this.identity.deviceId,
      trustAudit: this.trustAudit,
      log: this.log,
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
    // Reject oversized messages before parsing
    const sizeCheck = validateMessageSize(raw);
    if (!sizeCheck.valid) {
      this.metrics.inc(MESH_METRICS.INBOUND_REJECTED);
      this.log.warn(`mesh: rejected oversized message from ${connId.slice(0, 8)}…: ${sizeCheck.error}`);
      return;
    }

    await routeInboundMessage(raw, socket, connId, {
      peerRegistry: this.peerRegistry,
      contextPropagator: this.contextPropagator,
      worldModel: this.worldModel,
      eventBus: this.eventBus,
      rpcDispatcher: this.rpcDispatcher,
      intentRouterDeps: {
        deviceId: this.identity.deviceId,
        displayName: this.displayName,
        contextPropagator: this.contextPropagator,
        broadcastToUI: (event, payload) => this.broadcastToUI(event, payload),
        handlePlannerIntent: this.piSession
          ? (text, opts) => this.piSession!.handleOperatorIntent(text, opts)
          : undefined,
        log: this.log,
      },
    });
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
