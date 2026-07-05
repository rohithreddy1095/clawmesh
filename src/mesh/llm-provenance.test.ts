import { describe, expect, it } from "vitest";
import { createClawMeshCommandEnvelope } from "./command-envelope.js";
import { evaluateMeshForwardTrust } from "./trust-policy.js";
import { MockActuatorController } from "./mock-actuator.js";
import { createLlmEvidenceTrust, createLlmOnlyActuationTrust } from "./llm-provenance.js";
import { MeshRuntimeHarness } from "./test-helpers.js";
import type { MeshLlmProvider } from "./server-methods/llm-infer.js";
import type { MeshForwardPayload } from "./types.js";

describe("LLM provenance helpers", () => {
  it("constructs the only legal trust label for inference output", () => {
    expect(createLlmEvidenceTrust()).toEqual({
      evidence_sources: ["llm"],
      evidence_trust_tier: "T0_planning_inference",
    });
  });

  it("keeps llm-only actuation blocked at sender/receiver gate", () => {
    const payload: MeshForwardPayload = {
      channel: "clawmesh",
      to: "actuator:mock:valve-1",
      originGatewayId: "planner-node",
      idempotencyKey: "llm-only-1",
      trust: createLlmOnlyActuationTrust({
        minimum_trust_tier: "T0_planning_inference",
        verification_required: "none",
      }),
    };

    expect(evaluateMeshForwardTrust(payload)).toMatchObject({
      ok: false,
      code: "LLM_ONLY_ACTUATION_BLOCKED",
    });
  });

  it("keeps llm-only actuation blocked at executor gate", async () => {
    const controller = new MockActuatorController();
    const command = createClawMeshCommandEnvelope({
      target: { kind: "capability", ref: "actuator:mock:valve-1" },
      operation: { name: "open" },
      trust: createLlmOnlyActuationTrust({
        minimum_trust_tier: "T0_planning_inference",
        verification_required: "none",
      }),
    });

    await controller.handleForward({
      channel: "clawmesh",
      to: "actuator:mock:valve-1",
      originGatewayId: "bypass-test",
      idempotencyKey: "executor-llm-only",
      command,
      trust: command.trust,
    });

    const snapshot = controller.snapshot();
    expect(snapshot.records).toHaveLength(0);
    expect(snapshot.refusedCount).toBe(1);
    expect(snapshot.lastRefusal?.code).toBe("LLM_ONLY_ACTUATION_BLOCKED");
  });

  it("keeps llm.chunk events transient and out of the world model", async () => {
    const harness = new MeshRuntimeHarness();
    await harness.setup();
    try {
      const provider: MeshLlmProvider = {
        canServe: (model) => model === "fake/model",
        infer: async function* () {
          yield { delta: "streamed" };
          return { finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } };
        },
      };
      const server = await harness.startNode({
        name: "llm-server",
        disableDiscovery: true,
        serveLlmModels: ["fake/model"],
        llmProvider: provider,
      });
      const client = await harness.startNode({
        name: "llm-client",
        disableDiscovery: true,
        capabilities: ["channel:clawmesh"],
      });
      if (!server || !client) return;

      const connected = await harness.connect(client, server);
      expect(connected).toBe(true);

      const chunks: unknown[] = [];
      client.runtime.eventBus.on("llm.chunk", ({ peerDeviceId, chunk }) => {
        chunks.push({ peerDeviceId, chunk });
      });

      const result = await client.runtime.peerRegistry.invoke({
        deviceId: server.identity.deviceId,
        method: "llm.infer",
        params: {
          requestId: "chunk-proof",
          model: "fake/model",
          messages: [{ role: "user", content: "hello" }],
        },
        timeoutMs: 2_000,
      });

      expect(result.ok).toBe(true);
      expect(chunks).toEqual([
        {
          peerDeviceId: server.identity.deviceId,
          chunk: { requestId: "chunk-proof", seq: 0, delta: "streamed" },
        },
      ]);
      expect(client.runtime.worldModel.getRecentFrames(10)).toHaveLength(0);
      expect(server.runtime.worldModel.getRecentFrames(10)).toHaveLength(0);
    } finally {
      await harness.teardown();
    }
  });

  it("preserves T0 LLM provenance across a multi-hop context relay", async () => {
    const harness = new MeshRuntimeHarness();
    await harness.setup();
    try {
      const nodeA = await harness.startNode({ name: "t0-a", disableDiscovery: true });
      const nodeB = await harness.startNode({ name: "t0-b", disableDiscovery: true });
      const nodeC = await harness.startNode({ name: "t0-c", disableDiscovery: true });
      if (!nodeA || !nodeB || !nodeC) return;

      expect(await harness.connect(nodeA, nodeB)).toBe(true);
      expect(await harness.connect(nodeB, nodeC)).toBe(true);

      const relayed = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for relayed frame")), 2_000);
        nodeC.runtime.eventBus.on("context.frame.ingested", ({ frame }) => {
          if (frame.sourceDeviceId === nodeA.identity.deviceId && frame.kind === "inference") {
            clearTimeout(timer);
            resolve(frame);
          }
        });
      });

      nodeA.runtime.contextPropagator.broadcastInference({
        data: { result: "remote inference" },
        note: "multi-hop T0 proof",
      });

      const frame = await relayed as { trust: { evidence_sources: string[]; evidence_trust_tier: string } };
      expect(frame.trust).toEqual(createLlmEvidenceTrust());
    } finally {
      await harness.teardown();
    }
  });
});
