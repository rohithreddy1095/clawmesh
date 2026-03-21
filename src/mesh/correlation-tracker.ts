/**
 * CorrelationTracker — traces causal chains through the system.
 *
 * When a sensor reading triggers a threshold breach that causes
 * the planner to create a proposal that gets approved and executed,
 * this module traces the entire chain so operators can debug
 * "why did the pump turn on?"
 *
 * Chains are keyed by the originating event (usually a frame ID)
 * and accumulate steps as the event propagates through the system.
 */

export type ChainStep = {
  stage: string;
  timestamp: number;
  detail: string;
  data?: Record<string, unknown>;
};

export type CausalChain = {
  originId: string;
  startedAt: number;
  steps: ChainStep[];
};

export class CorrelationTracker {
  private chains = new Map<string, CausalChain>();
  private readonly maxChains: number;

  constructor(maxChains = 200) {
    this.maxChains = maxChains;
  }

  /**
   * Start a new causal chain from an originating event.
   */
  start(originId: string, stage: string, detail: string, data?: Record<string, unknown>): void {
    if (this.chains.size >= this.maxChains) {
      // Remove oldest chain
      const oldest = this.chains.keys().next().value;
      if (oldest) this.chains.delete(oldest);
    }
    this.chains.set(originId, {
      originId,
      startedAt: Date.now(),
      steps: [{ stage, timestamp: Date.now(), detail, data }],
    });
  }

  /**
   * Add a step to an existing chain.
   */
  addStep(originId: string, stage: string, detail: string, data?: Record<string, unknown>): void {
    const chain = this.chains.get(originId);
    if (!chain) return; // Chain not tracked — silently skip
    chain.steps.push({ stage, timestamp: Date.now(), detail, data });
  }

  /**
   * Get a chain by its origin ID.
   */
  get(originId: string): CausalChain | undefined {
    return this.chains.get(originId);
  }

  /**
   * Find chains that include a specific stage.
   */
  findByStage(stage: string): CausalChain[] {
    return [...this.chains.values()].filter(c =>
      c.steps.some(s => s.stage === stage),
    );
  }

  /**
   * Format a chain as a human-readable trace.
   */
  formatChain(originId: string): string | null {
    const chain = this.chains.get(originId);
    if (!chain) return null;

    return chain.steps.map((s, i) => {
      const elapsed = s.timestamp - chain.startedAt;
      return `${i + 1}. [${s.stage}] +${elapsed}ms: ${s.detail}`;
    }).join("\n");
  }

  get size(): number {
    return this.chains.size;
  }

  clear(): void {
    this.chains.clear();
  }
}
