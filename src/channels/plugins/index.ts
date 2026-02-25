/**
 * ClawMesh stub — channel plugins are stripped.
 * Only type exports and no-op helpers remain for compilation compatibility.
 */
import type { ChannelId, ChannelPlugin } from "./types.js";

export function listChannelPlugins(): ChannelPlugin[] {
  return [];
}

export function getChannelPlugin(_id: ChannelId): ChannelPlugin | undefined {
  return undefined;
}

export function normalizeChannelId(raw?: string | null): ChannelId | null {
  if (!raw) {
    return null;
  }
  return raw.trim() as ChannelId;
}

export type { ChannelId, ChannelPlugin } from "./types.js";
