import type { TriggerEntry, TriggerType } from "./trigger-queue.js";

export type PlannerRuntimeMode = "active" | "observing" | "suspended";
export type PlannerRuntimeStage =
  | "idle"
  | "queued"
  | "thinking"
  | "tool"
  | "error"
  | "observing"
  | "suspended";

export type PlannerQueueBreakdown = {
  operatorIntent: number;
  thresholdBreach: number;
  proactiveCheck: number;
};

export type PlannerQueueStats = PlannerQueueBreakdown & {
  total: number;
};

export type PlannerRuntimeSnapshot = {
  mode: PlannerRuntimeMode;
  stage: PlannerRuntimeStage;
  running: boolean;
  queueDepth: number;
  queue: PlannerQueueBreakdown;
  activeTriggerType?: TriggerType;
  activeReason?: string;
  activeConversationId?: string;
  activeRequestId?: string;
  activeToolName?: string;
  lastToolName?: string;
  lastIntent?: string;
  lastError?: string;
  updatedAtMs: number;
};

export class PlannerRuntimeState {
  private snapshot: PlannerRuntimeSnapshot;

  constructor(initialMode: PlannerRuntimeMode = "active") {
    const now = Date.now();
    this.snapshot = {
      mode: initialMode,
      stage: initialMode === "active" ? "idle" : initialMode,
      running: false,
      queueDepth: 0,
      queue: {
        operatorIntent: 0,
        thresholdBreach: 0,
        proactiveCheck: 0,
      },
      updatedAtMs: now,
    };
  }

  getSnapshot(): PlannerRuntimeSnapshot {
    return {
      ...this.snapshot,
      queue: { ...this.snapshot.queue },
    };
  }

  updateMode(mode: PlannerRuntimeMode): void {
    this.snapshot.mode = mode;
    if (mode === "observing" || mode === "suspended") {
      this.snapshot.stage = mode;
    } else if (!this.snapshot.running) {
      this.snapshot.stage = this.snapshot.queueDepth > 0 ? "queued" : "idle";
    }
    this.touch();
  }

  updateQueue(stats: PlannerQueueStats): void {
    this.snapshot.queueDepth = stats.total;
    this.snapshot.queue = {
      operatorIntent: stats.operatorIntent,
      thresholdBreach: stats.thresholdBreach,
      proactiveCheck: stats.proactiveCheck,
    };
    if (!this.snapshot.running) {
      if (this.snapshot.mode === "observing" || this.snapshot.mode === "suspended") {
        this.snapshot.stage = this.snapshot.mode;
      } else if (this.snapshot.stage !== "error") {
        this.snapshot.stage = stats.total > 0 ? "queued" : "idle";
      }
    }
    this.touch();
  }

  noteQueuedIntent(text: string): void {
    this.snapshot.lastIntent = text;
    if (!this.snapshot.running && this.snapshot.mode === "active") {
      this.snapshot.stage = "queued";
    }
    this.touch();
  }

  startCycle(trigger: TriggerEntry | undefined): void {
    this.snapshot.running = true;
    this.snapshot.activeTriggerType = trigger?.type;
    this.snapshot.activeReason = trigger ? describeTriggerReason(trigger) : undefined;
    this.snapshot.activeConversationId = trigger?.conversationId;
    this.snapshot.activeRequestId = trigger?.requestId;
    this.snapshot.activeToolName = undefined;
    if (trigger?.type === "operator_intent") {
      this.snapshot.lastIntent = describeTriggerReason(trigger);
    }
    if (this.snapshot.mode === "active") {
      this.snapshot.stage = "thinking";
    }
    this.touch();
  }

  markToolStart(toolName: string): void {
    this.snapshot.activeToolName = toolName;
    this.snapshot.lastToolName = toolName;
    this.snapshot.stage = "tool";
    this.touch();
  }

  markToolError(toolName: string, error?: string): void {
    this.snapshot.activeToolName = toolName;
    this.snapshot.lastToolName = toolName;
    this.snapshot.lastError = error ?? `Tool ${toolName} failed`;
    this.snapshot.stage = "error";
    this.touch();
  }

  markThinking(): void {
    if (this.snapshot.mode === "active") {
      this.snapshot.stage = this.snapshot.activeToolName ? "tool" : "thinking";
      this.touch();
    }
  }

  markError(error: string): void {
    this.snapshot.running = false;
    this.snapshot.activeTriggerType = undefined;
    this.snapshot.activeReason = undefined;
    this.snapshot.activeConversationId = undefined;
    this.snapshot.activeRequestId = undefined;
    this.snapshot.activeToolName = undefined;
    this.snapshot.lastError = error;
    this.snapshot.stage = "error";
    this.touch();
  }

  finishCycle(): void {
    this.snapshot.running = false;
    this.snapshot.activeTriggerType = undefined;
    this.snapshot.activeReason = undefined;
    this.snapshot.activeConversationId = undefined;
    this.snapshot.activeRequestId = undefined;
    this.snapshot.activeToolName = undefined;
    if (this.snapshot.mode === "observing" || this.snapshot.mode === "suspended") {
      this.snapshot.stage = this.snapshot.mode;
    } else {
      this.snapshot.stage = this.snapshot.queueDepth > 0 ? "queued" : "idle";
    }
    this.touch();
  }

  private touch(): void {
    this.snapshot.updatedAtMs = Date.now();
  }
}

export function describeTriggerReason(trigger: Pick<TriggerEntry, "type" | "reason">): string {
  if (trigger.type === "operator_intent") {
    return trigger.reason.replace(/^operator_intent:\s*/, "").replace(/^"|"$/g, "");
  }
  if (trigger.type === "threshold_breach") {
    return trigger.reason.replace(/^threshold_breach:\s*/, "");
  }
  return trigger.reason;
}
