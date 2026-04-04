import type {
  ContextFrame,
  MeshRuntimeEvent,
  MeshRuntimeHealth,
  MeshRuntimeStatus,
  PlannerRuntimeSnapshot,
} from "./store";

export type RuntimeTimelineEntry = {
  id: string;
  title: string;
  detail: string;
  timeLabel: string;
  tone: string;
};

export type PlannerRuntimeSummary = {
  stage: "idle" | "queued" | "thinking" | "tool" | "error" | "observing" | "suspended";
  stageLabel: string;
  conversationId?: string;
  lastIntent?: string;
  lastAgentMessage?: string;
  lastUpdatedLabel: string;
};

export function derivePlannerRuntimeSummary(
  frames: ContextFrame[],
  now = Date.now(),
  plannerRuntime?: PlannerRuntimeSnapshot | null,
): PlannerRuntimeSummary {
  const latestAgentResponse = latestFrameOfKind(frames, "agent_response");
  const latestHumanInput = latestFrameOfKind(frames, "human_input");
  const latestInference = latestFrameOfKind(frames, "inference");
  const latestRelevant = [latestAgentResponse, latestHumanInput, latestInference]
    .filter((frame): frame is ContextFrame => !!frame)
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  if (plannerRuntime) {
    const stage = normalizePlannerStage(plannerRuntime.stage);
    return {
      stage,
      stageLabel: formatPlannerStageLabel(stage),
      conversationId:
        plannerRuntime.activeConversationId ||
        (latestAgentResponse?.data?.conversationId as string | undefined),
      lastIntent: plannerRuntime.lastIntent || (latestHumanInput?.data?.intent as string | undefined),
      lastAgentMessage:
        (latestAgentResponse?.data?.message as string | undefined) ||
        (latestInference?.data?.reasoning as string | undefined),
      lastUpdatedLabel: plannerRuntime.updatedAtMs
        ? formatRelativeTime(now - plannerRuntime.updatedAtMs)
        : latestRelevant
          ? formatRelativeTime(now - latestRelevant.timestamp)
          : "No recent activity",
    };
  }

  const status = String(latestAgentResponse?.data?.status ?? "");
  const stage = normalizePlannerStage(status);

  return {
    stage,
    stageLabel: formatPlannerStageLabel(stage),
    conversationId: latestAgentResponse?.data?.conversationId as string | undefined,
    lastIntent: latestHumanInput?.data?.intent as string | undefined,
    lastAgentMessage:
      (latestAgentResponse?.data?.message as string | undefined) ||
      (latestInference?.data?.reasoning as string | undefined),
    lastUpdatedLabel: latestRelevant ? formatRelativeTime(now - latestRelevant.timestamp) : "No recent activity",
  };
}

export function buildRuntimeTimeline(frames: ContextFrame[], now = Date.now(), limit = 12): RuntimeTimelineEntry[] {
  return [...frames]
    .filter((frame) => ["human_input", "agent_response", "inference", "observation"].includes(frame.kind))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .map((frame) => ({
      id: frame.frameId,
      title: timelineTitle(frame),
      detail: timelineDetail(frame),
      timeLabel: formatRelativeTime(now - frame.timestamp),
      tone: timelineTone(frame),
    }));
}

export function formatRelativeTime(deltaMs: number): string {
  if (deltaMs < 5_000) return "just now";
  const seconds = Math.round(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

export function buildSystemEventTimeline(events: MeshRuntimeEvent[], now = Date.now(), limit = 12): RuntimeTimelineEntry[] {
  return [...events]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .map((event, index) => ({
      id: `${event.type}-${event.timestamp}-${index}`,
      title: event.type,
      detail: event.message,
      timeLabel: formatRelativeTime(now - event.timestamp),
      tone: event.type.includes("error") ? "text-mesh-alert" : event.type.includes("proposal") ? "text-claw-accent" : "text-mesh-info",
    }));
}

export function describePlannerSurface(
  runtimeHealth: MeshRuntimeHealth | null,
  runtimeStatus: MeshRuntimeStatus | null,
): Array<{ label: string; value: string }> {
  return [
    { label: "Planner mode", value: runtimeHealth?.plannerMode ?? runtimeStatus?.plannerMode ?? "disabled" },
    { label: "Planner model", value: runtimeHealth?.plannerModelSpec ?? runtimeStatus?.plannerModelSpec ?? "unknown" },
    { label: "Leader", value: formatLeader(runtimeHealth?.plannerLeader ?? runtimeStatus?.plannerActivity?.leader) },
    { label: "Discovery", value: runtimeHealth?.discoveryEnabled === false || runtimeStatus?.discoveryEnabled === false ? "static-only" : "enabled" },
  ];
}

export function describePlannerTrace(
  runtimeHealth: MeshRuntimeHealth | null,
  runtimeStatus: MeshRuntimeStatus | null,
): Array<{ label: string; value: string }> {
  const plannerRuntime = runtimeStatus?.plannerRuntime ?? runtimeHealth?.plannerRuntime;
  return [
    { label: "Runtime stage", value: plannerRuntime ? formatPlannerStageLabel(normalizePlannerStage(plannerRuntime.stage)) : "idle" },
    { label: "Queue depth", value: String(plannerRuntime?.queueDepth ?? 0) },
    { label: "Active trigger", value: plannerRuntime?.activeReason ?? plannerRuntime?.activeTriggerType ?? "none" },
    { label: "Active tool", value: plannerRuntime?.activeToolName ?? "none" },
    { label: "Last tool", value: plannerRuntime?.lastToolName ?? "none" },
    { label: "Last error", value: plannerRuntime?.lastError ?? "none" },
  ];
}

export function buildPlannerQueueMix(plannerRuntime?: PlannerRuntimeSnapshot | null): Array<{ key: string; label: string; count: number; tone: string }> {
  return [
    { key: "operatorIntent", label: "Operator", count: plannerRuntime?.queue.operatorIntent ?? 0, tone: "bg-claw-accent" },
    { key: "thresholdBreach", label: "Threshold", count: plannerRuntime?.queue.thresholdBreach ?? 0, tone: "bg-mesh-info" },
    { key: "proactiveCheck", label: "Proactive", count: plannerRuntime?.queue.proactiveCheck ?? 0, tone: "bg-white/55" },
  ];
}

function latestFrameOfKind(frames: ContextFrame[], kind: ContextFrame["kind"]): ContextFrame | undefined {
  return [...frames]
    .filter((frame) => frame.kind === kind)
    .sort((a, b) => b.timestamp - a.timestamp)[0];
}

function normalizePlannerStage(stage: string | undefined): PlannerRuntimeSummary["stage"] {
  if (stage === "queued" || stage === "thinking" || stage === "tool" || stage === "error" || stage === "observing" || stage === "suspended") {
    return stage;
  }
  return "idle";
}

function formatPlannerStageLabel(stage: PlannerRuntimeSummary["stage"]): string {
  switch (stage) {
    case "queued":
      return "Queued";
    case "thinking":
      return "Thinking";
    case "tool":
      return "Tool";
    case "error":
      return "Error";
    case "observing":
      return "Observing";
    case "suspended":
      return "Suspended";
    default:
      return "Idle";
  }
}

function timelineTitle(frame: ContextFrame): string {
  switch (frame.kind) {
    case "human_input":
      return "Operator intent";
    case "agent_response": {
      const status = String(frame.data?.status ?? "response");
      return `Planner ${status}`;
    }
    case "inference":
      return "Planner reasoning";
    case "observation":
      return `${frame.sourceDisplayName ?? frame.sourceDeviceId.slice(0, 12)} observation`;
    default:
      return frame.kind;
  }
}

function timelineDetail(frame: ContextFrame): string {
  switch (frame.kind) {
    case "human_input":
      return String(frame.data?.intent ?? "Operator submitted an intent");
    case "agent_response": {
      const status = String(frame.data?.status ?? "response");
      if (status === "queued") return "Planner queued this turn behind current work.";
      if (status === "thinking") return "Planner is actively processing this turn.";
      return truncate(String(frame.data?.message ?? status), 180);
    }
    case "inference":
      return truncate(String(frame.data?.reasoning ?? frame.note ?? "Planner emitted reasoning"), 180);
    case "observation": {
      const metric = String(frame.data?.metric ?? "metric");
      const value = frame.data?.value;
      const zone = frame.data?.zone ? ` (${String(frame.data.zone)})` : "";
      return `${metric}: ${String(value ?? "—")}${zone}`;
    }
    default:
      return truncate(JSON.stringify(frame.data), 180);
  }
}

function timelineTone(frame: ContextFrame): string {
  if (frame.kind === "human_input") return "text-claw-accent";
  if (frame.kind === "agent_response") {
    const status = String(frame.data?.status ?? "");
    if (status === "error") return "text-mesh-alert";
    if (status === "queued") return "text-foreground/60";
    if (status === "thinking") return "text-mesh-info";
    return "text-mesh-active";
  }
  if (frame.kind === "observation") return "text-mesh-info";
  return "text-foreground/70";
}

function truncate(text: string, max = 180): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatLeader(leader: { kind?: string; deviceId?: string; role?: string } | undefined): string {
  if (!leader || leader.kind === "none") return "none";
  const device = leader.deviceId ? `${leader.deviceId.slice(0, 12)}…` : "unknown";
  return `${leader.kind}:${leader.role ?? "node"}:${device}`;
}
