import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function resolveStateDir(explicit?: string): string {
  if (explicit?.trim()) return explicit;
  const override = process.env.CLAWMESH_STATE_DIR?.trim();
  if (override) return override;
  return path.join(os.homedir(), ".clawmesh");
}

function resolveMeshIdPath(stateDir?: string): string {
  return path.join(resolveStateDir(stateDir), "mesh", "mesh-id");
}

export function deriveNamedMeshId(meshName: string, _originatorDeviceId?: string): string {
  return createHash("sha256")
    .update(`clawmesh|mesh|${meshName}`)
    .digest("hex");
}

export function loadOrCreateMeshId(params: {
  stateDir?: string;
  meshName?: string;
  originatorDeviceId?: string;
} = {}): string {
  if (params.meshName) {
    return deriveNamedMeshId(params.meshName, params.originatorDeviceId);
  }

  const filePath = resolveMeshIdPath(params.stateDir);
  try {
    const existing = fs.readFileSync(filePath, "utf8").trim();
    if (existing) return existing;
  } catch {
    // fall through to create
  }

  const meshId = randomUUID();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${meshId}\n`, "utf8");
  return meshId;
}
