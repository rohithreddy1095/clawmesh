import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MeshGatewayTarget } from "./types.mesh.js";

function resolveStateDir(): string {
  const override = process.env.CLAWMESH_STATE_DIR?.trim() || process.env.OPENCLAW_STATE_DIR?.trim();
  if (override) {
    return override;
  }
  return path.join(os.homedir(), ".clawmesh");
}

const GATEWAYS_FILE = "mesh/gateways.json";

function resolveGatewaysPath(): string {
  return path.join(resolveStateDir(), GATEWAYS_FILE);
}

export function loadGatewayTargets(): MeshGatewayTarget[] {
  const filePath = resolveGatewaysPath();
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry: unknown): entry is MeshGatewayTarget =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as MeshGatewayTarget).name === "string" &&
        typeof (entry as MeshGatewayTarget).url === "string",
    );
  } catch {
    return [];
  }
}

export function saveGatewayTarget(target: MeshGatewayTarget): void {
  const filePath = resolveGatewaysPath();
  const existing = loadGatewayTargets();
  const idx = existing.findIndex((t) => t.name === target.name);
  if (idx >= 0) {
    existing[idx] = target;
  } else {
    existing.push(target);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(existing, null, 2)}\n`, { mode: 0o600 });
}

export function removeGatewayTarget(name: string): boolean {
  const existing = loadGatewayTargets();
  const idx = existing.findIndex((t) => t.name === name);
  if (idx < 0) {
    return false;
  }
  existing.splice(idx, 1);
  const filePath = resolveGatewaysPath();
  fs.writeFileSync(filePath, `${JSON.stringify(existing, null, 2)}\n`, { mode: 0o600 });
  return true;
}
