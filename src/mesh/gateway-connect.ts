import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import type { DeviceIdentity } from "../infra/device-identity.js";
import {
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
} from "../infra/device-identity.js";
import { rawDataToString } from "../infra/ws.js";

/**
 * Build a canonical payload string for device authentication signing.
 * Format: pipe-delimited fields, v2 includes the challenge nonce.
 */
function buildDeviceAuthPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce: string;
}): string {
  const version = params.nonce ? "v2" : "v1";
  const scopes = params.scopes.join(",");
  const token = params.token ?? "";
  const base = [
    version,
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
  ];
  if (version === "v2") {
    base.push(params.nonce ?? "");
  }
  return base.join("|");
}

export type GatewayConnectOptions = {
  url: string;
  identity: DeviceIdentity;
  password?: string;
  token?: string;
  role?: string;
  scopes?: string[];
  displayName?: string;
  timeoutMs?: number;
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};

export type GatewayConnectResult = {
  ok: boolean;
  server?: { version: string; connId: string };
  protocol?: number;
  methods?: string[];
  events?: string[];
  presence?: Array<{
    host?: string;
    id?: string;
    platform?: string;
    mode?: string;
    roles?: string[];
    deviceId?: string;
  }>;
  auth?: { deviceToken: string; role: string; scopes: string[] };
  error?: string;
  ws?: WebSocket;
};

/**
 * Connect to a remote OpenClaw gateway using the full gateway protocol
 * (challenge-response with Ed25519 device identity signing).
 */
export function connectToGateway(opts: GatewayConnectOptions): Promise<GatewayConnectResult> {
  const log = opts.log ?? { info: () => {}, warn: () => {}, error: () => {} };
  const role = opts.role ?? "node";
  const scopes = opts.scopes ?? ["mesh:connect"];
  const clientId = "node-host";
  const clientMode = "node";
  const timeoutMs = opts.timeoutMs ?? 15_000;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ws.close();
      resolve({ ok: false, error: "connection timed out" });
    }, timeoutMs);

    const ws = new WebSocket(opts.url, { maxPayload: 10 * 1024 * 1024 });

    ws.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });

    ws.on("close", (code, reason) => {
      clearTimeout(timer);
      // If we haven't resolved yet, this is an unexpected close
      resolve({ ok: false, error: `closed (${code}): ${rawDataToString(reason)}` });
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(rawDataToString(data));

        // Handle challenge
        if (msg.type === "event" && msg.event === "connect.challenge") {
          const nonce: string = msg.payload.nonce;
          const signedAtMs = Date.now();

          const payload = buildDeviceAuthPayload({
            deviceId: opts.identity.deviceId,
            clientId,
            clientMode,
            role,
            scopes,
            signedAtMs,
            token: opts.token ?? null,
            nonce,
          });
          const signature = signDevicePayload(opts.identity.privateKeyPem, payload);
          const publicKey = publicKeyRawBase64UrlFromPem(opts.identity.publicKeyPem);

          const connectFrame = {
            type: "req",
            id: randomUUID(),
            method: "connect",
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: clientId,
                displayName: opts.displayName ?? "clawmesh",
                version: "0.1.0",
                platform: process.platform,
                mode: clientMode,
              },
              role,
              scopes,
              auth: opts.password
                ? { password: opts.password }
                : opts.token
                  ? { token: opts.token }
                  : undefined,
              device: {
                id: opts.identity.deviceId,
                publicKey,
                signature,
                signedAt: signedAtMs,
                nonce,
              },
            },
          };

          log.info("Sending signed connect...");
          ws.send(JSON.stringify(connectFrame));
          return;
        }

        // Handle connect response
        if (msg.type === "res") {
          clearTimeout(timer);
          if (msg.ok) {
            const h = msg.payload;
            resolve({
              ok: true,
              server: h.server,
              protocol: h.protocol,
              methods: h.features?.methods,
              events: h.features?.events,
              presence: h.snapshot?.presence,
              auth: h.auth,
              ws,
            });
          } else {
            ws.close();
            const details = msg.error?.details
              ? ` (${JSON.stringify(msg.error.details)})`
              : "";
            resolve({
              ok: false,
              error: `${msg.error?.code}: ${msg.error?.message}${details}`,
            });
          }
          return;
        }
      } catch {
        // ignore parse errors
      }
    });
  });
}
