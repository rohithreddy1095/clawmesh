import { describe, expect, it, beforeEach, vi } from "vitest";
import { MeshCapabilityRegistry } from "./capabilities.js";
import { resolveMeshRoute } from "./routing.js";
import { createMeshForwardHandlers } from "./server-methods/forward.js";
import type { DeviceIdentity } from "../infra/device-identity.js";

describe("ClawMesh integration tests", () => {
  const localIdentity: DeviceIdentity = {
    deviceId: "local-device-id-abc",
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----\n",
    privateKeyPem: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
  };

  describe("capability-based routing + forwarding", () => {
    let registry: MeshCapabilityRegistry;

    beforeEach(() => {
      registry = new MeshCapabilityRegistry();
    });

    it("routes to mesh peer and forward handler delivers message", async () => {
      // Setup: peer-jetson has telegram capability
      registry.updatePeer("peer-jetson", ["channel:telegram", "skill:weather"]);

      // Step 1: Route resolves to mesh
      const route = resolveMeshRoute({
        channel: "telegram",
        capabilityRegistry: registry,
      });
      expect(route).toEqual({ kind: "mesh", peerDeviceId: "peer-jetson" });

      // Step 2: Forward handler processes the message
      const forwarded: unknown[] = [];
      const handlers = createMeshForwardHandlers({
        identity: localIdentity,
        onForward: (payload) => {
          forwarded.push(payload);
        },
      });

      const result = await new Promise<{
        ok: boolean;
        payload?: unknown;
        error?: { code: string; message: string };
      }>((resolve) => {
        void handlers["mesh.message.forward"]({
          params: {
            channel: "telegram",
            to: "+1234567890",
            message: "Hello from mesh!",
            originGatewayId: "peer-jetson",
          },
          respond: (ok, payload, error) => resolve({ ok, payload, error }),
        });
      });

      expect(result.ok).toBe(true);
      expect(forwarded).toHaveLength(1);
      expect(forwarded[0]).toMatchObject({
        channel: "telegram",
        to: "+1234567890",
        message: "Hello from mesh!",
      });
    });

    it("forward handler rejects loop (origin === local)", async () => {
      const handlers = createMeshForwardHandlers({ identity: localIdentity });

      const result = await new Promise<{
        ok: boolean;
        error?: { code: string; message: string };
      }>((resolve) => {
        void handlers["mesh.message.forward"]({
          params: {
            channel: "telegram",
            to: "+1234567890",
            message: "looped",
            originGatewayId: localIdentity.deviceId, // same as local
          },
          respond: (ok, _payload, error) => resolve({ ok, error }),
        });
      });

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("LOOP_DETECTED");
    });

    it("forward handler rejects invalid params", async () => {
      const handlers = createMeshForwardHandlers({ identity: localIdentity });

      const result = await new Promise<{
        ok: boolean;
        error?: { code: string; message: string };
      }>((resolve) => {
        void handlers["mesh.message.forward"]({
          params: { channel: "telegram" }, // missing 'to' and 'originGatewayId'
          respond: (ok, _payload, error) => resolve({ ok, error }),
        });
      });

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("INVALID_PARAMS");
    });
  });

  describe("local-first routing with capability updates", () => {
    let registry: MeshCapabilityRegistry;

    beforeEach(() => {
      registry = new MeshCapabilityRegistry();
    });

    it("initially unavailable, then available after peer registers", () => {
      // No peers, no local capabilities
      let route = resolveMeshRoute({ channel: "slack", capabilityRegistry: registry });
      expect(route.kind).toBe("unavailable");

      // Peer joins with slack capability
      registry.updatePeer("peer-mac", ["channel:slack"]);
      route = resolveMeshRoute({ channel: "slack", capabilityRegistry: registry });
      expect(route).toEqual({ kind: "mesh", peerDeviceId: "peer-mac" });
    });

    it("falls back to mesh when local capability removed", () => {
      registry.updatePeer("peer-mac", ["channel:telegram"]);
      const localCaps = new Set(["channel:telegram"]);

      // Local available → local
      let route = resolveMeshRoute({
        channel: "telegram",
        capabilityRegistry: registry,
        localCapabilities: localCaps,
      });
      expect(route.kind).toBe("local");

      // Local removed → mesh fallback
      localCaps.delete("channel:telegram");
      route = resolveMeshRoute({
        channel: "telegram",
        capabilityRegistry: registry,
        localCapabilities: localCaps,
      });
      expect(route).toEqual({ kind: "mesh", peerDeviceId: "peer-mac" });
    });

    it("becomes unavailable when peer disconnects", () => {
      registry.updatePeer("peer-mac", ["channel:telegram"]);
      let route = resolveMeshRoute({ channel: "telegram", capabilityRegistry: registry });
      expect(route.kind).toBe("mesh");

      // Peer disconnects
      registry.removePeer("peer-mac");
      route = resolveMeshRoute({ channel: "telegram", capabilityRegistry: registry });
      expect(route.kind).toBe("unavailable");
    });
  });

  describe("multi-peer capability resolution", () => {
    let registry: MeshCapabilityRegistry;

    beforeEach(() => {
      registry = new MeshCapabilityRegistry();
    });

    it("different channels route to different peers", () => {
      registry.updatePeer("peer-mac", ["channel:telegram", "channel:whatsapp"]);
      registry.updatePeer("peer-jetson", ["channel:slack", "channel:discord"]);

      const telegramRoute = resolveMeshRoute({
        channel: "telegram",
        capabilityRegistry: registry,
      });
      expect(telegramRoute).toEqual({ kind: "mesh", peerDeviceId: "peer-mac" });

      const slackRoute = resolveMeshRoute({
        channel: "slack",
        capabilityRegistry: registry,
      });
      expect(slackRoute).toEqual({ kind: "mesh", peerDeviceId: "peer-jetson" });
    });

    it("peer capability update changes routing", () => {
      registry.updatePeer("peer-mac", ["channel:telegram"]);

      let route = resolveMeshRoute({ channel: "slack", capabilityRegistry: registry });
      expect(route.kind).toBe("unavailable");

      // Peer updates capabilities to include slack
      registry.updatePeer("peer-mac", ["channel:telegram", "channel:slack"]);
      route = resolveMeshRoute({ channel: "slack", capabilityRegistry: registry });
      expect(route).toEqual({ kind: "mesh", peerDeviceId: "peer-mac" });
    });
  });

  describe("forward handler onForward callback", () => {
    it("handles async onForward", async () => {
      const handlers = createMeshForwardHandlers({
        identity: localIdentity,
        onForward: async (payload) => {
          // Simulate async processing
          await new Promise((r) => setTimeout(r, 10));
        },
      });

      const result = await new Promise<{ ok: boolean; payload?: unknown }>((resolve) => {
        void handlers["mesh.message.forward"]({
          params: {
            channel: "telegram",
            to: "+1",
            message: "test",
            originGatewayId: "remote-peer",
          },
          respond: (ok, payload) => resolve({ ok, payload }),
        });
      });

      expect(result.ok).toBe(true);
    });

    it("handles onForward failure gracefully", async () => {
      const handlers = createMeshForwardHandlers({
        identity: localIdentity,
        onForward: () => {
          throw new Error("delivery failed");
        },
      });

      const result = await new Promise<{
        ok: boolean;
        error?: { code: string; message: string };
      }>((resolve) => {
        void handlers["mesh.message.forward"]({
          params: {
            channel: "telegram",
            to: "+1",
            message: "test",
            originGatewayId: "remote-peer",
          },
          respond: (ok, _payload, error) => resolve({ ok, error }),
        });
      });

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("DELIVERY_FAILED");
    });
  });
});
