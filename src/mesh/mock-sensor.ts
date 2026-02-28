import type { ContextPropagator } from "./context-propagator.js";

/**
 * Mock sensor for testing context propagation.
 * Simulates periodic soil moisture readings that broadcast as context frames.
 */
export class MockSensor {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private opts: {
      contextPropagator: ContextPropagator;
      intervalMs?: number;
      zone?: string;
    },
  ) {}

  start(): void {
    if (this.interval) {
      return;
    }

    const intervalMs = this.opts.intervalMs ?? 5000;
    const zone = this.opts.zone ?? "zone-1";

    this.interval = setInterval(() => {
      // Simulate moisture reading: 10-30%
      const moisture = 10 + Math.random() * 20;
      const status =
        moisture < 20 ? "critical" : moisture < 25 ? "low" : "normal";

      this.opts.contextPropagator.broadcastObservation({
        data: {
          zone,
          metric: "moisture",
          value: parseFloat(moisture.toFixed(1)),
          unit: "%",
          threshold: 20,
          status,
        },
        note: `Soil moisture in ${zone}: ${moisture.toFixed(1)}% (${status})`,
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
