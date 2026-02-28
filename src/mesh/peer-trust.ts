import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type TrustedPeer = {
  deviceId: string;
  displayName?: string;
  publicKey?: string;
  addedAt: string;
};

type TrustedPeersStore = {
  version: 1;
  peers: TrustedPeer[];
};

const EMPTY_STORE: TrustedPeersStore = { version: 1, peers: [] };

function resolveStateDir(): string {
  return process.env.OPENCLAW_STATE_DIR?.trim() || path.join(os.homedir(), ".openclaw");
}

function resolveStorePath(): string {
  return path.join(resolveStateDir(), "mesh", "trusted-peers.json");
}

async function ensureFile(filePath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.promises.access(filePath);
  } catch {
    await fs.promises.writeFile(filePath, `${JSON.stringify(EMPTY_STORE, null, 2)}\n`, "utf8");
  }
}

async function readStore(filePath: string): Promise<TrustedPeer[]> {
  await ensureFile(filePath);
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<TrustedPeersStore>;
    return Array.isArray(parsed.peers) ? parsed.peers : [];
  } catch {
    return [];
  }
}

async function writeStore(filePath: string, peers: TrustedPeer[]): Promise<void> {
  const payload: TrustedPeersStore = { version: 1, peers };
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function listTrustedPeers(): Promise<TrustedPeer[]> {
  return await readStore(resolveStorePath());
}

export async function addTrustedPeer(params: {
  deviceId: string;
  displayName?: string;
  publicKey?: string;
}): Promise<{ added: boolean }> {
  const filePath = resolveStorePath();
  const peers = await readStore(filePath);
  if (peers.some((p) => p.deviceId === params.deviceId)) {
    return { added: false };
  }
  const entry: TrustedPeer = {
    deviceId: params.deviceId,
    displayName: params.displayName,
    publicKey: params.publicKey,
    addedAt: new Date().toISOString(),
  };
  await writeStore(filePath, [...peers, entry]);
  return { added: true };
}

export async function removeTrustedPeer(deviceId: string): Promise<{ removed: boolean }> {
  const filePath = resolveStorePath();
  const peers = await readStore(filePath);
  const next = peers.filter((p) => p.deviceId !== deviceId);
  if (next.length === peers.length) {
    return { removed: false };
  }
  await writeStore(filePath, next);
  return { removed: true };
}

export async function isTrustedPeer(deviceId: string): Promise<boolean> {
  const peers = await readStore(resolveStorePath());
  return peers.some((p) => p.deviceId === deviceId);
}

export async function getTrustedPeer(deviceId: string): Promise<TrustedPeer | null> {
  const peers = await readStore(resolveStorePath());
  return peers.find((p) => p.deviceId === deviceId) ?? null;
}

