import { createClawMeshCli } from "./src/cli/clawmesh-cli.js";

const program = createClawMeshCli();
await program.parseAsync(process.argv);
