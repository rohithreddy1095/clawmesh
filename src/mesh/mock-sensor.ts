import type { ContextPropagator } from "./context-propagator.js";

/**
 * Mock sensor for testing context propagation.
 * Simulates periodic soil moisture readings that broadcast as context frames.
 *
 * Produces a realistic drying pattern: starts at ~35% and drifts downward
 * with small random jitter (±0.5% per reading). This creates a physically
 * plausible signal that won't be flagged as sensor malfunction by the LLM.
 */
export class MockSensor {
  private interval: ReturnType<typeof setInterval> | null = null;
  private currentMoisture = 35; // Start at 35% (normal range)

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
      // Realistic drying: drift down ~0.3-0.8% per reading with small jitter
      const dryingRate = 0.3 + Math.random() * 0.5; // 0.3 to 0.8% loss per interval
      const jitter = (Math.random() - 0.5) * 1.0;   // ±0.5% noise
      this.currentMoisture -= dryingRate;
      this.currentMoisture += jitter;

      // Clamp to 5-40% range, reset to 35 if we hit bottom (simulates watering)
      if (this.currentMoisture < 5) {
        this.currentMoisture = 35; // Simulate irrigation reset
      }
      if (this.currentMoisture > 40) {
        this.currentMoisture = 40;
      }

      const moisture = this.currentMoisture;
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
