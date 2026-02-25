import { Command } from "commander";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import {
  addTrustedPeer,
  listTrustedPeers,
  removeTrustedPeer,
} from "../mesh/peer-trust.js";

export function createClawMeshCli(): Command {
  const program = new Command();
  program
    .name("clawmesh")
    .description("ClawMesh — mesh-first AI gateway")
    .version("0.1.0");

  // ── identity ─────────────────────────────────────────────
  program
    .command("identity")
    .description("Print this device's mesh identity (deviceId and public key)")
    .action(() => {
      const identity = loadOrCreateDeviceIdentity();
      console.log(`Device ID:   ${identity.deviceId}`);
      console.log(`Public Key:\n${identity.publicKeyPem.trim()}`);
    });

  // ── trust ────────────────────────────────────────────────
  const trust = program
    .command("trust")
    .description("Manage trusted mesh peers");

  trust
    .command("list")
    .description("List all trusted peers")
    .action(async () => {
      const peers = await listTrustedPeers();
      if (peers.length === 0) {
        console.log("No trusted peers.");
        return;
      }
      for (const peer of peers) {
        const name = peer.displayName ? ` (${peer.displayName})` : "";
        console.log(`  ${peer.deviceId}${name}  added ${peer.addedAt}`);
      }
    });

  trust
    .command("add <deviceId>")
    .description("Add a peer to the trust store")
    .option("--name <name>", "Display name for the peer")
    .action(async (deviceId: string, opts: { name?: string }) => {
      const result = await addTrustedPeer({
        deviceId,
        displayName: opts.name,
      });
      if (result.added) {
        console.log(`Trusted peer added: ${deviceId}`);
      } else {
        console.log(`Peer already trusted: ${deviceId}`);
      }
    });

  trust
    .command("remove <deviceId>")
    .description("Remove a peer from the trust store")
    .action(async (deviceId: string) => {
      const result = await removeTrustedPeer(deviceId);
      if (result.removed) {
        console.log(`Peer removed: ${deviceId}`);
      } else {
        console.log(`Peer not found: ${deviceId}`);
      }
    });

  // ── peers ────────────────────────────────────────────────
  program
    .command("peers")
    .description("List currently connected mesh peers")
    .action(() => {
      // In a running gateway, this would query PeerRegistry.
      // For now, print a placeholder until the gateway server is running.
      console.log("No gateway running. Start with `clawmesh start` first.");
    });

  // ── status ───────────────────────────────────────────────
  program
    .command("status")
    .description("Show gateway and mesh status")
    .action(() => {
      const identity = loadOrCreateDeviceIdentity();
      console.log(`Device ID:  ${identity.deviceId}`);
      console.log("Gateway:    not running");
      console.log("Mesh peers: 0");
    });

  return program;
}
