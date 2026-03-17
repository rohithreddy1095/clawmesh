/**
 * PiSession configuration builder — constructs PiSessionOptions from runtime opts.
 *
 * Extracted from MeshNodeRuntime.startPiSessionLoop() for testability.
 */

import type { TaskProposal } from "../agents/types.js";

export interface PiSessionConfig {
  modelSpec: string;
  thinkingLevel: string;
  proactiveIntervalMs: number;
}

export interface PiSessionEventWiring {
  onProposalCreated?: (proposal: TaskProposal) => void;
  onProposalResolved?: (proposal: TaskProposal) => void;
  onModeChange?: (mode: string, reason: string) => void;
}

/**
 * Resolve PiSession configuration from runtime options.
 * Applies defaults where options are not provided.
 */
export function resolvePiSessionConfig(opts: {
  piSessionModelSpec?: string;
  piSessionThinkingLevel?: string;
  plannerProactiveIntervalMs?: number;
}): PiSessionConfig {
  return {
    modelSpec: opts.piSessionModelSpec ?? "anthropic/claude-sonnet-4-5-20250929",
    thinkingLevel: opts.piSessionThinkingLevel ?? "off",
    proactiveIntervalMs: opts.plannerProactiveIntervalMs ?? 60_000,
  };
}

/**
 * Validate PiSession model spec format.
 * Returns null if valid, or an error message if invalid.
 */
export function validatePiSessionModelSpec(spec: string): string | null {
  const parts = spec.split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return `Invalid model spec "${spec}". Use "provider/model-id".`;
  }
  return null;
}

/**
 * Get the default model spec.
 */
export function getDefaultModelSpec(): string {
  return "anthropic/claude-sonnet-4-5-20250929";
}

/**
 * Get default thinking level.
 */
export function getDefaultThinkingLevel(): string {
  return "off";
}

/**
 * Get default proactive interval in ms.
 */
export function getDefaultProactiveIntervalMs(): number {
  return 60_000;
}
