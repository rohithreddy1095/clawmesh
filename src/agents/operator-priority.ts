import type { TriggerEntry } from "./trigger-queue.js";

export function shouldEnqueueProactiveCheck(params: {
  running: boolean;
  pendingTriggerCount: number;
  hasPendingOperatorIntent: boolean;
}): boolean {
  if (params.running) return false;
  if (params.hasPendingOperatorIntent) return false;
  if (params.pendingTriggerCount > 0) return false;
  return true;
}

export function partitionSystemTriggersForOperatorTurn(systemTriggers: TriggerEntry[]): {
  immediateSystemTriggers: TriggerEntry[];
  deferredSystemTriggers: TriggerEntry[];
} {
  const immediateSystemTriggers: TriggerEntry[] = [];
  const deferredSystemTriggers: TriggerEntry[] = [];

  for (const trigger of systemTriggers) {
    if (trigger.type === "proactive_check") {
      deferredSystemTriggers.push(trigger);
      continue;
    }
    immediateSystemTriggers.push(trigger);
  }

  return { immediateSystemTriggers, deferredSystemTriggers };
}
