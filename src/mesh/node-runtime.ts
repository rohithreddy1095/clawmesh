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
import { evaluateMeshForwardTrust } from "./trust-policy.js";
import type {
  ClawMeshCommandEnvelopeV1,
  MeshForwardPayload,
  MeshForwardTrustMetadata,
} from "./types.js";
import { createMeshTools } from "../agents/tools/mesh-tools.js";
import { runIntelligenceAgent } from "../agents/intelligence-runner.js";
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
  /** Enable intelligence mode (starts LLM agent with mesh tools). */
  enableIntelligence?: boolean;
  /** LLM model ID for intelligence mode (default: claude-sonnet-4-5-20250929). */
  intelligenceModel?: string;
  /** Override the default system prompt for the intelligence agent. */
  intelligenceSystemPrompt?: string;
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
  readonly mockActuator?: MockActuatorController;
  readonly discovery?: MeshDiscovery;

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
  private wss: WebSocketServer | null = null;
  private piAgentAbort?: AbortController;

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

    this.handlers = sharedHandlers;
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

    // Start mDNS discovery
    (this as any).discovery = new MeshDiscovery({
      localDeviceId: this.identity.deviceId,
      localPort: this.listenAddress().port,
      displayName: this.displayName,
    });
    this.discovery?.start();
    this.discovery?.on("peer-discovered", (peer) => {
      this.log.info(`mesh: discovered peer ${peer.deviceId.slice(0, 12)}… via mDNS`);
    });

    for (const peer of this.staticPeers) {
      this.connectToPeer(peer);
    }

    // Start intelligence agent if enabled
    if (this.opts.enableIntelligence) {
      this.startIntelligenceAgent();
    }

    return this.listenAddress();
  }

  async stop(): Promise<void> {
    // Stop intelligence agent
    if (this.piAgentAbort) {
      this.piAgentAbort.abort();
      this.log.info("mesh: intelligence agent stopped");
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

  private startIntelligenceAgent(): void {
    this.piAgentAbort = new AbortController();

    const systemPrompt =
      this.opts.intelligenceSystemPrompt ?? this.buildFarmIntelligencePrompt();
    const tools = createMeshTools(this);

    runIntelligenceAgent({
      model: this.opts.intelligenceModel ?? "claude-sonnet-4-5-20250929",
      systemPrompt,
      tools,
      signal: this.piAgentAbort.signal,
      log: this.log,
    }).catch((err) => {
      this.log.error(`mesh: intelligence agent error: ${err}`);
    });

    this.log.info("mesh: intelligence agent started with mesh tools");
  }

  private buildFarmIntelligencePrompt(): string {
    const nodeName = this.displayName ?? this.identity.deviceId.slice(0, 12);
    return `You are the intelligence layer for a ClawMesh farm management system.

# Your Role
Monitor sensor data from field nodes, reason over farm state, and orchestrate
irrigation, monitoring, and other farm operations.

# This Node
- Name: ${nodeName}
- Device ID: ${this.identity.deviceId.slice(0, 12)}...

# Available Tools
1. **query_world_model** — View sensor observations, events from all mesh nodes
2. **execute_mesh_command** — Send commands to field nodes (pumps, sensors, etc.)
3. **list_mesh_capabilities** — Discover available sensors and actuators

# Decision Framework
When you observe critical conditions (e.g., low moisture, temperature alerts):
1. Query world model to understand current state
2. Check mesh capabilities to find relevant sensors/actuators
3. Reason about the best action
4. Execute commands with clear reasoning
5. Monitor feedback (execution results propagate back as context)

# Farm Operations Examples
- Moisture below threshold -> start irrigation pump
- Temperature spike -> alert and activate cooling
- Human input -> interpret and execute farm tasks

Be proactive, safe, and always explain your reasoning.`;
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
      this.worldModel.ingest(contextFrame);
      return;
    }

    // --- MOCK INTELLIGENCE HANDLER FOR UI TESTING ---
    if (frame.type === "req" && frame.method === "mesh.message.forward") {
      const fwdParams = (frame.params ?? {}) as Record<string, unknown>;

      // If targeting agent:pi, we intercept it as a local intent parse
      if (fwdParams.to === "agent:pi" && fwdParams.channel === "clawmesh") {
        const cmd = fwdParams.commandDraft as Record<string, unknown> | undefined;
        const operation = cmd?.operation as Record<string, unknown> | undefined;
        if (operation?.name === "intent:parse") {
          const intentText = (operation.params as Record<string, unknown>)?.text ?? "Unknown intent";
          this.log.info(`[mock-pi] Received natural language intent: "${intentText}"`);

          // Broadcast as human input
          this.contextPropagator.broadcastHumanInput({
            data: { intent: intentText },
            note: `Operator submitted intent`,
          });

          // Simulate processing delay for inference broadcast
          setTimeout(() => {
            this.contextPropagator.broadcastInference({
              data: {
                decision: `Simulated execution of: ${intentText}`,
                targetRef: "actuator:mock:simulated",
                operation: "execute",
              },
              note: `Intelligence: Parsed intent and determined next best action.`,
            });
            this.log.info(`[mock-pi] Broadcasted mock inference for intent.`);
          }, 2000);
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
