import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMeshServerHandlers, type MeshServerHandlerDeps } from "./peer-server.js";
import { PeerRegistry } from "./peer-registry.js";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { buildMeshConnectAuth } from "./handshake.js";
import { addTrustedPeer } from "./peer-trust.js";
import { withTempHome } from "./test-helpers.js";
import type { PeerSession } from "./types.js";

describe("createMeshServerHandlers", () => {
  it("creates a mesh.connect handler", () => {
    const deps: MeshServerHandlerDeps = {
      identity: loadOrCreateDeviceIdentity("/tmp/test-peer-server-" + Date.now() + "/device.json"),
      peerRegistry: new PeerRegistry(),
    };
    const handlers = createMeshServerHandlers(deps);
    expect(handlers["mesh.connect"]).toBeDefined();
    expect(typeof handlers["mesh.connect"]).toBe("function");
  });

  it("rejects connection with missing params", async () => {
    await withTempHome(async () => {
      const identity = loadOrCreateDeviceIdentity();
      const handlers = createMeshServerHandlers({
        identity,
        peerRegistry: new PeerRegistry(),
      });

      let responseOk: boolean | undefined;
      let responseError: any;
      await handlers["mesh.connect"]({
        req: {},
        params: {},
        respond: (ok, _payload, error) => {
          responseOk = ok;
          responseError = error;
        },
      });

      expect(responseOk).toBe(false);
      expect(responseError?.code).toBe("INVALID_PARAMS");
    });
  });

  it("rejects connection from untrusted peer", async () => {
    await withTempHome(async () => {
      const serverIdentity = loadOrCreateDeviceIdentity();
      const clientIdentity = loadOrCreateDeviceIdentity("/tmp/test-ps-client-" + Date.now() + "/device.json");
      const auth = buildMeshConnectAuth({ identity: clientIdentity });

      const handlers = createMeshServerHandlers({
        identity: serverIdentity,
        peerRegistry: new PeerRegistry(),
      });

      let responseOk: boolean | undefined;
      let responseError: any;
      await handlers["mesh.connect"]({
        req: {},
        params: auth,
        respond: (ok, _payload, error) => {
          responseOk = ok;
          responseError = error;
        },
      });

      expect(responseOk).toBe(false);
      expect(responseError?.code).toBe("UNTRUSTED_PEER");
    });
  });

  it("accepts connection from trusted peer with valid signature", async () => {
    await withTempHome(async () => {
      const serverIdentity = loadOrCreateDeviceIdentity();
      const clientIdentity = loadOrCreateDeviceIdentity("/tmp/test-ps-trusted-" + Date.now() + "/device.json");

      // Trust the client
      await addTrustedPeer({ deviceId: clientIdentity.deviceId });

      const auth = buildMeshConnectAuth({
        identity: clientIdentity,
        displayName: "test-client",
        capabilities: ["channel:test"],
      });

      const peerRegistry = new PeerRegistry();
      let connectedSession: PeerSession | undefined;
      const handlers = createMeshServerHandlers({
        identity: serverIdentity,
        peerRegistry,
        displayName: "test-server",
        capabilities: ["channel:clawmesh"],
        onPeerConnected: (session) => { connectedSession = session; },
      });

      let responseOk: boolean | undefined;
      let responsePayload: any;
      await handlers["mesh.connect"]({
        req: { _connId: "conn-test", _socket: null },
        params: auth,
        respond: (ok, payload) => {
          responseOk = ok;
          responsePayload = payload;
        },
      });

      expect(responseOk).toBe(true);
      expect(responsePayload.deviceId).toBe(serverIdentity.deviceId);
      expect(responsePayload.publicKey).toBeTruthy();
      expect(responsePayload.signature).toBeTruthy();
      expect(responsePayload.displayName).toBe("test-server");
      expect(responsePayload.capabilities).toContain("channel:clawmesh");

      // Verify peer was registered
      expect(connectedSession).toBeDefined();
      expect(connectedSession!.deviceId).toBe(clientIdentity.deviceId);
      expect(connectedSession!.capabilities).toContain("channel:test");
      expect(peerRegistry.get(clientIdentity.deviceId)).toBeDefined();
    });
  });

  it("rejects connection with invalid signature", async () => {
    await withTempHome(async () => {
      const serverIdentity = loadOrCreateDeviceIdentity();
      const clientIdentity = loadOrCreateDeviceIdentity("/tmp/test-ps-badsig-" + Date.now() + "/device.json");

      // Trust the client
      await addTrustedPeer({ deviceId: clientIdentity.deviceId });

      // Build auth but tamper with signature
      const auth = buildMeshConnectAuth({ identity: clientIdentity });
      (auth as any).signature = "INVALID_SIGNATURE";

      const handlers = createMeshServerHandlers({
        identity: serverIdentity,
        peerRegistry: new PeerRegistry(),
      });

      let responseOk: boolean | undefined;
      let responseError: any;
      await handlers["mesh.connect"]({
        req: {},
        params: auth,
        respond: (ok, _payload, error) => {
          responseOk = ok;
          responseError = error;
        },
      });

      expect(responseOk).toBe(false);
      expect(responseError?.code).toBe("AUTH_FAILED");
    });
  });
});
