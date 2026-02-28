import { randomUUID } from "node:crypto";
import { createClawMeshCommandEnvelope } from "./command-envelope.js";
import type { PeerRegistry } from "./peer-registry.js";
import type {
  ClawMeshCommandEnvelopeV1,
  MeshForwardPayload,
  MeshForwardTrustMetadata,
} from "./types.js";

export type ForwardResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};

/**
 * Forward a message to a mesh peer for delivery on a channel
 * that is not available locally.
 */
export async function forwardMessageToPeer(params: {
  peerRegistry: PeerRegistry;
  peerDeviceId: string;
  channel: string;
  to: string;
  message?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  accountId?: string;
  originGatewayId: string;
  idempotencyKey?: string;
  command?: ClawMeshCommandEnvelopeV1;
  commandDraft?: Omit<ClawMeshCommandEnvelopeV1, "version" | "kind" | "commandId" | "createdAtMs"> & {
    commandId?: string;
    createdAtMs?: number;
  };
  trust?: MeshForwardTrustMetadata;
}): Promise<ForwardResult> {
  const command = params.commandDraft ? createClawMeshCommandEnvelope(params.commandDraft) : params.command;
  const trust = params.trust ?? command?.trust;

  const payload: MeshForwardPayload = {
    channel: params.channel,
    to: params.to,
    message: params.message,
    mediaUrl: params.mediaUrl,
    mediaUrls: params.mediaUrls,
    accountId: params.accountId,
    originGatewayId: params.originGatewayId,
    idempotencyKey: params.idempotencyKey ?? randomUUID(),
    command,
    trust,
  };

  const result = await params.peerRegistry.invoke({
    deviceId: params.peerDeviceId,
    method: "mesh.message.forward",
    params: payload,
    timeoutMs: 30_000,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error?.message ?? "mesh forward failed",
    };
  }

  const resultPayload = result.payload as { messageId?: string } | undefined;
  return {
    ok: true,
    messageId: resultPayload?.messageId,
  };
}
