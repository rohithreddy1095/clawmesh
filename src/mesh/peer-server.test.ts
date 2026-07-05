import { describe, it, expect } from "vitest";
import { createMeshServerHandlers, type MeshServerHandlerDeps } from "./peer-server.js";
import { PeerRegistry } from "./peer-registry.js";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { buildMeshConnectAuth } from "./handshake.js";
import { addTrustedPeer } from "./peer-trust.js";
import { withTempHome } from "./test-helpers.js";
import type { PeerSession } from "./types.js";

type HandlerResult = { ok?: boolean; payload?: unknown; error?: { code?: string } };

/** Invoke a handler and capture its response. */
async function call(
  handlers: ReturnType<typeof createMeshServerHandlers>,
  method: string,
  params: Record<string, unknown>,
  connId = "conn-test",
): Promise<HandlerResult> {
  const result: HandlerResult = {};
  await handlers[method]({
    req: { _connId: connId, _socket: null },
    params,
    respond: (ok, payload, error) => {
      result.ok = ok;
      result.payload = payload;
      result.error = error;
    },
  });
  return result;
}

/** Run the mesh.challenge step and return the issued nonce. */
async function getNonce(
  handlers: ReturnType<typeof createMeshServerHandlers>,
  connId = "conn-test",
): Promise<string> {
  const res = await call(handlers, "mesh.challenge", {}, connId);
  return (res.payload as { nonce: string }).nonce;
}

describe("createMeshServerHandlers", () => {
  it("creates mesh.connect and mesh.challenge handlers", () => {
    const deps: MeshServerHandlerDeps = {
      identity: loadOrCreateDeviceIdentity("/tmp/test-peer-server-" + Date.now() + "/device.json"),
      peerRegistry: new PeerRegistry(),
    };
    const handlers = createMeshServerHandlers(deps);
    expect(typeof handlers["mesh.connect"]).toBe("function");
    expect(typeof handlers["mesh.challenge"]).toBe("function");
  });

  it("rejects connection with missing params", async () => {
    await withTempHome(async () => {
      const identity = loadOrCreateDeviceIdentity();
      const handlers = createMeshServerHandlers({
        identity,
        peerRegistry: new PeerRegistry(),
      });
      const res = await call(handlers, "mesh.connect", {});
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe("INVALID_PARAMS");
    });
  });

  it("rejects connection from untrusted peer", async () => {
    await withTempHome(async () => {
      const serverIdentity = loadOrCreateDeviceIdentity();
      const clientIdentity = loadOrCreateDeviceIdentity(
        "/tmp/test-ps-client-" + Date.now() + "/device.json",
      );
      const handlers = createMeshServerHandlers({
        identity: serverIdentity,
        peerRegistry: new PeerRegistry(),
      });
      const nonce = await getNonce(handlers);
      const auth = buildMeshConnectAuth({ identity: clientIdentity, nonce });
      const res = await call(handlers, "mesh.connect", { ...auth, clientNonce: "cn" });
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe("UNTRUSTED_PEER");
    });
  });

  it("accepts connection from trusted peer with valid signature", async () => {
    await withTempHome(async () => {
      const serverIdentity = loadOrCreateDeviceIdentity();
      const clientIdentity = loadOrCreateDeviceIdentity(
        "/tmp/test-ps-trusted-" + Date.now() + "/device.json",
      );
      await addTrustedPeer({ deviceId: clientIdentity.deviceId });

      const peerRegistry = new PeerRegistry();
      let connectedSession: PeerSession | undefined;
      const handlers = createMeshServerHandlers({
        identity: serverIdentity,
        peerRegistry,
        displayName: "test-server",
        capabilities: ["channel:clawmesh"],
        role: "planner",
        onPeerConnected: (session) => {
          connectedSession = session;
        },
      });

      const nonce = await getNonce(handlers);
      const auth = buildMeshConnectAuth({
        identity: clientIdentity,
        nonce,
        displayName: "test-client",
        capabilities: ["channel:test"],
        role: "field",
      });
      const res = await call(handlers, "mesh.connect", { ...auth, clientNonce: "client-n" });

      expect(res.ok).toBe(true);
      const payload = res.payload as Record<string, unknown>;
      expect(payload.deviceId).toBe(serverIdentity.deviceId);
      expect(payload.publicKey).toBeTruthy();
      expect(payload.signature).toBeTruthy();
      expect(payload.nonce).toBe("client-n"); // server signs over OUR nonce
      expect(payload.displayName).toBe("test-server");
      expect(payload.capabilities).toContain("channel:clawmesh");
      expect(payload.role).toBe("planner");

      expect(connectedSession).toBeDefined();
      expect(connectedSession!.deviceId).toBe(clientIdentity.deviceId);
      expect(connectedSession!.capabilities).toContain("channel:test");
      expect(connectedSession!.role).toBe("field");
      expect(peerRegistry.get(clientIdentity.deviceId)).toBeDefined();
    });
  });

  it("rejects connection with invalid signature", async () => {
    await withTempHome(async () => {
      const serverIdentity = loadOrCreateDeviceIdentity();
      const clientIdentity = loadOrCreateDeviceIdentity(
        "/tmp/test-ps-badsig-" + Date.now() + "/device.json",
      );
      await addTrustedPeer({ deviceId: clientIdentity.deviceId });

      const handlers = createMeshServerHandlers({
        identity: serverIdentity,
        peerRegistry: new PeerRegistry(),
      });
      const nonce = await getNonce(handlers);
      const auth = buildMeshConnectAuth({ identity: clientIdentity, nonce });
      const res = await call(handlers, "mesh.connect", {
        ...auth,
        signature: "INVALID_SIGNATURE",
        clientNonce: "cn",
      });
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe("AUTH_FAILED");
    });
  });

  it("rejects connection from a different mesh", async () => {
    await withTempHome(async () => {
      const serverIdentity = loadOrCreateDeviceIdentity();
      const clientIdentity = loadOrCreateDeviceIdentity(
        "/tmp/test-ps-meshid-" + Date.now() + "/device.json",
      );
      await addTrustedPeer({ deviceId: clientIdentity.deviceId });

      const handlers = createMeshServerHandlers({
        identity: serverIdentity,
        peerRegistry: new PeerRegistry(),
        meshId: "mesh-server",
      });
      const nonce = await getNonce(handlers);
      const auth = buildMeshConnectAuth({
        identity: clientIdentity,
        nonce,
        meshId: "mesh-client",
      });
      const res = await call(handlers, "mesh.connect", { ...auth, clientNonce: "cn" });
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe("MESH_ID_MISMATCH");
    });
  });

  it("rejects mesh.connect without a prior challenge", async () => {
    await withTempHome(async () => {
      const serverIdentity = loadOrCreateDeviceIdentity();
      const clientIdentity = loadOrCreateDeviceIdentity(
        "/tmp/test-ps-nochal-" + Date.now() + "/device.json",
      );
      await addTrustedPeer({ deviceId: clientIdentity.deviceId });

      const handlers = createMeshServerHandlers({
        identity: serverIdentity,
        peerRegistry: new PeerRegistry(),
      });
      // Client invents its own nonce without asking for a challenge.
      const auth = buildMeshConnectAuth({ identity: clientIdentity, nonce: "self-chosen" });
      const res = await call(handlers, "mesh.connect", { ...auth, clientNonce: "cn" });
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe("AUTH_NONCE_INVALID");
    });
  });
});
