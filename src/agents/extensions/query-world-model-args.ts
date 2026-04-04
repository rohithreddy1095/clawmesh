import type { ContextFrameKind } from "../../mesh/context-types.js";

const QUERY_WORLD_MODEL_KIND_ALIASES: Record<string, Extract<ContextFrameKind, "observation" | "event" | "human_input" | "inference"> | "all"> = {
  all: "all",
  observation: "observation",
  observations: "observation",
  event: "event",
  events: "event",
  human_input: "human_input",
  humaninput: "human_input",
  input: "human_input",
  inference: "inference",
  inferences: "inference",
};

export function normalizeQueryWorldModelKind(
  rawKind: unknown,
): Extract<ContextFrameKind, "observation" | "event" | "human_input" | "inference"> | "all" {
  if (typeof rawKind !== "string") return "all";

  const normalized = rawKind
    .replace(/<\|[^|]*\|>/g, "")
    .replace(/^[\s'"`]+|[\s'"`]+$/g, "")
    .replace(/\s+/g, "_")
    .toLowerCase();

  return QUERY_WORLD_MODEL_KIND_ALIASES[normalized] ?? "all";
}

export function normalizeQueryWorldModelLimit(rawLimit: unknown, defaultLimit = 20): number {
  if (typeof rawLimit === "number" && Number.isFinite(rawLimit)) {
    return clampLimit(rawLimit);
  }

  if (typeof rawLimit === "string") {
    const normalized = rawLimit.replace(/[^0-9-]/g, "");
    if (normalized) {
      const parsed = Number.parseInt(normalized, 10);
      if (Number.isFinite(parsed)) {
        return clampLimit(parsed);
      }
    }
  }

  return defaultLimit;
}

function clampLimit(value: number): number {
  const rounded = Math.trunc(value);
  if (rounded < 1) return 1;
  if (rounded > 100) return 100;
  return rounded;
}
