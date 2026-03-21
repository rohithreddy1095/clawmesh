/**
 * Tests for trust store security — public key pinning workflow.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { addTrustedPeer, listTrustedPeers, removeTrustedPeer, getTrustedPeer } from "./peer-trust.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Use a temporary directory for test trust store
const testStateDir = join(tmpdir(), `clawmesh-trust-test-${Date.now()}`);

describe("Trust store: public key pinning", () => {
  beforeAll(() => {
    process.env.CLAWMESH_STATE_DIR = testStateDir;
  });

  afterAll(() => {
    delete process.env.CLAWMESH_STATE_DIR;
  });

  it("adds peer without public key (TOFU mode)", async () => {
    const result = await addTrustedPeer({ deviceId: "peer-tofu" });
    expect(result.added).toBe(true);

    const peer = await getTrustedPeer("peer-tofu");
    expect(peer).not.toBeNull();
    expect(peer!.publicKey).toBeUndefined();
  });

  it("adds peer with pinned public key", async () => {
    const result = await addTrustedPeer({
      deviceId: "peer-pinned",
      publicKey: "base64url-pubkey-abc123",
    });
    expect(result.added).toBe(true);

    const peer = await getTrustedPeer("peer-pinned");
    expect(peer!.publicKey).toBe("base64url-pubkey-abc123");
  });

  it("duplicate add returns added: false", async () => {
    await addTrustedPeer({ deviceId: "peer-dup" });
    const result = await addTrustedPeer({ deviceId: "peer-dup" });
    expect(result.added).toBe(false);
  });

  it("remove works correctly", async () => {
    await addTrustedPeer({ deviceId: "peer-remove" });
    const result = await removeTrustedPeer("peer-remove");
    expect(result.removed).toBe(true);
    expect(await getTrustedPeer("peer-remove")).toBeNull();
  });

  it("list returns all trusted peers", async () => {
    const peers = await listTrustedPeers();
    expect(peers.length).toBeGreaterThanOrEqual(2); // From earlier tests
  });
});
