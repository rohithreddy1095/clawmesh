#!/usr/bin/env node
import { createClawMeshCli } from "../.clawmesh-run/src/cli/clawmesh-cli.js";

const program = createClawMeshCli();
await program.parseAsync(process.argv);
