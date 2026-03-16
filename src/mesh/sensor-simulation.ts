/**
 * Sensor simulation helpers — pure functions extracted from MockSensor.
 *
 * Handles moisture reading simulation, status classification,
 * and value clamping without I/O dependencies.
 */

/**
 * Simulate one step of moisture drying.
 *
 * @param current - Current moisture level (%)
 * @param dryingRate - Rate of moisture loss per step (default: random 0.3-0.8%)
 * @param jitter - Random noise (default: random ±0.5%)
 * @returns New moisture value after clamping and possible irrigation reset
 */
export function simulateMoistureStep(
  current: number,
  dryingRate?: number,
  jitter?: number,
): number {
  const rate = dryingRate ?? (0.3 + Math.random() * 0.5);
  const noise = jitter ?? ((Math.random() - 0.5) * 1.0);

  let next = current - rate + noise;

  // Clamp and reset
  if (next < 5) next = 35; // irrigation reset
  if (next > 40) next = 40;

  return parseFloat(next.toFixed(1));
}

/**
 * Classify moisture status based on value.
 */
export function classifyMoistureStatus(moisture: number): "critical" | "low" | "normal" {
  if (moisture < 20) return "critical";
  if (moisture < 25) return "low";
  return "normal";
}

/**
 * Clamp a value to a range.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Generate a mock observation data payload for sensor readings.
 */
export function buildObservationPayload(params: {
  zone: string;
  metric: string;
  value: number;
  unit: string;
  threshold?: number;
}): {
  zone: string;
  metric: string;
  value: number;
  unit: string;
  threshold?: number;
  status: "critical" | "low" | "normal";
} {
  const status = params.metric === "moisture"
    ? classifyMoistureStatus(params.value)
    : params.value < (params.threshold ?? 20) ? "critical" : "normal";

  return {
    zone: params.zone,
    metric: params.metric,
    value: params.value,
    unit: params.unit,
    threshold: params.threshold,
    status,
  };
}

/**
 * Generate a readable note for a sensor observation.
 */
export function buildObservationNote(
  zone: string,
  metric: string,
  value: number,
  unit: string,
  status: string,
): string {
  return `${capitalize(metric)} in ${zone}: ${value}${unit} (${status})`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
