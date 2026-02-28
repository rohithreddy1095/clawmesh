import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { MeshStaticPeer } from "../config/types.mesh.js";
import { rawDataToString } from "../infra/ws.js";
import type { DeviceIdentity } from "../infra/device-identity.js";
import { forwardMessageToPeer } from "./forwarding.js";
import { MeshCapabilityRegistry } from "./capabilities.js";
import { MockActuatorController, createMockActuatorHandlers } from "./mock-actuator.js";
import { MeshPeerClient } from "./peer-client.js";
import { PeerRegistry } from "./peer-registry.js";
import { createMeshServerHandlers } from "./peer-server.js";
import { createMeshForwardHandlers } from "./server-methods/forward.js";
import { createMeshPeersHandlers } from "./server-methods/peers.js";
import type {
  ClawMeshCommandEnvelopeV1,
  MeshForwardPayload,
  MeshForwardTrustMetadata,
} from "./types.js";

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
  readonly mockActuator?: MockActuatorController;

  private readonly host: string;
  private readonly requestedPort: number;
  private readonly displayName?: string;
  private readonly capabilities: string[];
  private readonly staticPeers: MeshStaticPeer[];
  private readonly log: Required<MeshNodeRuntimeOptions>["log"];
  private readonly handlers: GatewayRequestHandlers;

  private readonly outboundClients = new Map<string, MeshPeerClient>();
  private readonly inboundSocketConnIds = new Map<WebSocket, string>();
  private wss: WebSocketServer | null = null;

  constructor(opts: MeshNodeRuntimeOptions) {
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

    for (const peer of this.staticPeers) {
      this.connectToPeer(peer);
    }

    return this.listenAddress();
  }

  async stop(): Promise<void> {
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
    const trust = {
      ...defaultActuationTrust(),
      ...(params.trust ?? {}),
    } as ClawMeshCommandEnvelopeV1["trust"];

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

    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
      return;
    }

    const frame = parsed as Record<string, unknown>;
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
