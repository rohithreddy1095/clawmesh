/**
 * Shared types for the ClawMesh intelligence layer.
 */

export type ApprovalLevel = "L0" | "L1" | "L2" | "L3";

export type TaskProposal = {
  taskId: string;
  summary: string;
  reasoning: string;
  targetRef: string;
  operation: string;
  operationParams?: Record<string, unknown>;
  peerDeviceId: string;
  /** Planner node that originated this proposal, when available. */
  plannerDeviceId?: string;
  /** Declared role of the originating planner. */
  plannerRole?: "planner" | "standby-planner";
  approvalLevel: ApprovalLevel;
  status: "proposed" | "awaiting_approval" | "approved" | "executing" | "completed" | "rejected" | "failed";
  createdBy: "intelligence" | "operator" | "schedule";
  triggerFrameIds: string[];
  createdAt: number;
  /** How long the proposal is valid (ms). After this, auto-expire. Default: 30 min. */
  expiresAtMs?: number;
  resolvedAt?: number;
  result?: { ok: boolean; error?: string; payload?: unknown };
  resolvedBy?: string;
};

export type ThresholdRule = {
  ruleId: string;
  metric: string;
  zone?: string;
  belowThreshold?: number;
  aboveThreshold?: number;
  cooldownMs?: number;
  promptHint: string;
};

export type FarmContext = {
  siteName: string;
  zones: Array<{ zoneId: string; name: string; crops?: string[]; area?: string }>;
  assets: Array<{ assetId: string; type: string; zoneId?: string; capabilities?: string[] }>;
  operations: Array<{ name: string; description: string; approvalLevel: ApprovalLevel }>;
  safetyRules: string[];
};
