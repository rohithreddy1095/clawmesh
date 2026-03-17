/**
 * Actuator logic helpers — pure functions extracted from MockActuatorController.
 *
 * Handles status derivation and operation classification.
 */

/**
 * Derive actuator status from operation name and params.
 *
 * - "open", "start", "on", "enable" → "active"
 * - "close", "stop", "off", "disable" → "inactive"
 * - "set" with state param → use state value
 * - otherwise → "command:<opName>"
 */
export function deriveActuatorStatus(
  opName: string,
  params?: Record<string, unknown>,
): string {
  const op = opName.toLowerCase();
  if (op === "open" || op === "start" || op === "on" || op === "enable") {
    return "active";
  }
  if (op === "close" || op === "stop" || op === "off" || op === "disable") {
    return "inactive";
  }
  if (op === "set" && params && "state" in params && typeof params.state === "string") {
    return String(params.state);
  }
  return `command:${opName}`;
}

/**
 * Check if an operation is an activation command.
 */
export function isActivation(opName: string): boolean {
  const op = opName.toLowerCase();
  return op === "open" || op === "start" || op === "on" || op === "enable";
}

/**
 * Check if an operation is a deactivation command.
 */
export function isDeactivation(opName: string): boolean {
  const op = opName.toLowerCase();
  return op === "close" || op === "stop" || op === "off" || op === "disable";
}

/**
 * Check if a target ref refers to an actuator.
 */
export function isActuatorRef(targetRef: string): boolean {
  return targetRef.startsWith("actuator:");
}

/**
 * Check if a target ref refers to a sensor.
 */
export function isSensorRef(targetRef: string): boolean {
  return targetRef.startsWith("sensor:");
}

/**
 * Parse a target ref into its components.
 * Format: "type:subtype:identifier" (e.g. "actuator:pump:P1")
 */
export function parseTargetRef(targetRef: string): {
  type: string;
  subtype: string;
  identifier: string;
} {
  const parts = targetRef.split(":");
  return {
    type: parts[0] ?? "",
    subtype: parts[1] ?? "",
    identifier: parts.slice(2).join(":") || "",
  };
}
