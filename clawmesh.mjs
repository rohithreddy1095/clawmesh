#!/usr/bin/env node
import { createClawMeshCli } from "./src/cli/clawmesh-cli.js";

const program = createClawMeshCli();
program.parse(process.argv);
