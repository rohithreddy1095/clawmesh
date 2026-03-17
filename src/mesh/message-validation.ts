/**
 * Message validation — size and format checks for inbound mesh messages.
 *
 * Production protection against:
 * - Oversized messages that could OOM the process
 * - Malformed JSON that wastes parse time
 * - Invalid frame types
 */

/** Maximum message size (1MB). */
export const MAX_MESSAGE_SIZE = 1_048_576;

/** Maximum frame data size (512KB). */
export const MAX_FRAME_DATA_SIZE = 524_288;

export type MessageValidationResult = {
  valid: boolean;
  error?: string;
  code?: "TOO_LARGE" | "INVALID_JSON" | "MISSING_TYPE" | "INVALID_TYPE" | "DATA_TOO_LARGE";
};

/**
 * Validate an inbound message string before JSON parsing.
 * Quick checks to reject obviously bad messages early.
 */
export function validateMessageSize(raw: string): MessageValidationResult {
  if (raw.length > MAX_MESSAGE_SIZE) {
    return {
      valid: false,
      error: `Message too large: ${raw.length} bytes (max ${MAX_MESSAGE_SIZE})`,
      code: "TOO_LARGE",
    };
  }
  return { valid: true };
}

/**
 * Validate a parsed message structure.
 */
export function validateMessageStructure(parsed: unknown): MessageValidationResult {
  if (!parsed || typeof parsed !== "object") {
    return { valid: false, error: "Message is not an object", code: "INVALID_JSON" };
  }

  const msg = parsed as Record<string, unknown>;

  if (!msg.type) {
    return { valid: false, error: "Message missing 'type' field", code: "MISSING_TYPE" };
  }

  const validTypes = ["req", "res", "event"];
  if (!validTypes.includes(msg.type as string)) {
    return {
      valid: false,
      error: `Invalid message type: ${String(msg.type)} (expected: ${validTypes.join(", ")})`,
      code: "INVALID_TYPE",
    };
  }

  // Check data size for events
  if (msg.type === "event" && msg.payload) {
    const payloadStr = JSON.stringify(msg.payload);
    if (payloadStr.length > MAX_FRAME_DATA_SIZE) {
      return {
        valid: false,
        error: `Event payload too large: ${payloadStr.length} bytes (max ${MAX_FRAME_DATA_SIZE})`,
        code: "DATA_TOO_LARGE",
      };
    }
  }

  return { valid: true };
}

/**
 * Combined validation: size check + parse + structure check.
 * Returns the parsed message if valid, or null with error details.
 */
export function validateAndParse(raw: string): {
  parsed: Record<string, unknown> | null;
  error?: string;
  code?: string;
} {
  const sizeResult = validateMessageSize(raw);
  if (!sizeResult.valid) {
    return { parsed: null, error: sizeResult.error, code: sizeResult.code };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { parsed: null, error: "Invalid JSON", code: "INVALID_JSON" };
  }

  const structResult = validateMessageStructure(parsed);
  if (!structResult.valid) {
    return { parsed: null, error: structResult.error, code: structResult.code };
  }

  return { parsed: parsed as Record<string, unknown> };
}
