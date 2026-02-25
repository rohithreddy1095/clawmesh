import { describe, expect, it } from "vitest";

describe("ClawMesh CLI", () => {
  it("imports cli module cleanly", async () => {
    const mod = await import("./clawmesh-cli.js");
    expect(mod.createClawMeshCli).toBeDefined();
    expect(typeof mod.createClawMeshCli).toBe("function");
  });

  it("creates a commander program with expected commands", async () => {
    const { createClawMeshCli } = await import("./clawmesh-cli.js");
    const program = createClawMeshCli();

    // Collect command names
    const commandNames = program.commands.map((cmd) => cmd.name());

    expect(commandNames).toContain("identity");
    expect(commandNames).toContain("trust");
    expect(commandNames).toContain("peers");
    expect(commandNames).toContain("status");
  });

  it("identity command exists with correct description", async () => {
    const { createClawMeshCli } = await import("./clawmesh-cli.js");
    const program = createClawMeshCli();

    const identityCmd = program.commands.find((cmd) => cmd.name() === "identity");
    expect(identityCmd).toBeDefined();
    expect(identityCmd?.description()).toContain("device");
  });

  it("trust command has add, remove, and list subcommands", async () => {
    const { createClawMeshCli } = await import("./clawmesh-cli.js");
    const program = createClawMeshCli();

    const trustCmd = program.commands.find((cmd) => cmd.name() === "trust");
    expect(trustCmd).toBeDefined();

    const subCommandNames = trustCmd?.commands.map((cmd) => cmd.name()) ?? [];
    expect(subCommandNames).toContain("add");
    expect(subCommandNames).toContain("remove");
    expect(subCommandNames).toContain("list");
  });
});
