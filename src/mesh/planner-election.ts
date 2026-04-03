import type { MeshNodeRole } from "./types.js";

export type PlannerCandidate = {
  deviceId: string;
  role?: MeshNodeRole;
};

export type PlannerLeader =
  | { kind: "none" }
  | { kind: "local"; deviceId: string; role: MeshNodeRole }
  | { kind: "peer"; deviceId: string; role: MeshNodeRole };

export function isPlannerEligible(role?: MeshNodeRole): role is "planner" | "standby-planner" {
  return role === "planner" || role === "standby-planner";
}

function roleScore(role: MeshNodeRole): number {
  switch (role) {
    case "planner":
      return 2;
    case "standby-planner":
      return 1;
    default:
      return 0;
  }
}

export function choosePlannerLeader(params: {
  self: PlannerCandidate;
  peers: PlannerCandidate[];
}): PlannerLeader {
  const candidates = [params.self, ...params.peers].filter(
    (candidate): candidate is PlannerCandidate & { role: "planner" | "standby-planner" } =>
      isPlannerEligible(candidate.role),
  );

  if (candidates.length === 0) {
    return { kind: "none" };
  }

  candidates.sort((a, b) => {
    const byRole = roleScore(b.role) - roleScore(a.role);
    if (byRole !== 0) return byRole;
    return a.deviceId.localeCompare(b.deviceId);
  });

  const winner = candidates[0];
  if (winner.deviceId === params.self.deviceId) {
    return { kind: "local", deviceId: winner.deviceId, role: winner.role };
  }
  return { kind: "peer", deviceId: winner.deviceId, role: winner.role };
}
