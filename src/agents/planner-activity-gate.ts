import type { PlannerActivity } from "../mesh/planner-election.js";
import type { TriggerType } from "./trigger-queue.js";

export function shouldProcessPlannerTrigger(
  activity: PlannerActivity,
  triggerType: TriggerType | undefined,
): boolean {
  if (!triggerType) return false;
  if (triggerType === "operator_intent") return true;
  return activity.shouldHandleAutonomous;
}

export function shouldWakePlannerOnActivityChange(
  previous: PlannerActivity,
  next: PlannerActivity,
  triggerType: TriggerType | undefined,
): boolean {
  if (!shouldProcessPlannerTrigger(next, triggerType)) return false;
  if (triggerType === "operator_intent") return false;
  return !previous.shouldHandleAutonomous && next.shouldHandleAutonomous;
}
