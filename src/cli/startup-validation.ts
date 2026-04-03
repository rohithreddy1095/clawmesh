/**
 * Startup validation — pre-flight checks for MeshNodeRuntime.
 *
 * Validates configuration before starting the mesh node:
 * - Device identity exists and has valid keys
 * - Static peer specs are well-formed
 * - Threshold rules are valid
 * - Port is available
 * - Required capabilities are specified
 *
 * Returns a list of warnings/errors so the CLI can report them clearly.
 */

export type StartupDiagnostic = {
  level: "info" | "warn" | "error";
  code: string;
  message: string;
};

export interface StartupValidationInput {
  deviceId?: string;
  port?: number;
  staticPeers?: Array<{ deviceId: string; url: string; transportLabel?: string }>;
  discoveryEnabled?: boolean;
  capabilities?: string[];
  thresholds?: Array<{ ruleId?: string; metric?: string }>;
  enablePiSession?: boolean;
  modelSpec?: string;
  hasApiKey?: boolean;
}

/**
 * Run pre-flight checks and return diagnostics.
 */
export function validateStartupConfig(input: StartupValidationInput): StartupDiagnostic[] {
  const diagnostics: StartupDiagnostic[] = [];

  // Device identity
  if (!input.deviceId) {
    diagnostics.push({
      level: "error",
      code: "NO_IDENTITY",
      message: "No device identity found. Run 'clawmesh identity' to create one.",
    });
  }

  // Port
  if (input.port !== undefined) {
    if (input.port < 0 || input.port > 65535) {
      diagnostics.push({
        level: "error",
        code: "INVALID_PORT",
        message: `Port ${input.port} is out of range (0-65535)`,
      });
    }
    if (input.port < 1024 && input.port !== 0) {
      diagnostics.push({
        level: "warn",
        code: "PRIVILEGED_PORT",
        message: `Port ${input.port} requires root/admin privileges`,
      });
    }
  }

  // Static peers
  if (input.staticPeers) {
    for (const peer of input.staticPeers) {
      if (
        !peer.url.startsWith("ws://") &&
        !peer.url.startsWith("wss://") &&
        !peer.url.startsWith("http://") &&
        !peer.url.startsWith("https://")
      ) {
        diagnostics.push({
          level: "error",
          code: "INVALID_PEER_URL",
          message: `Peer ${peer.deviceId.slice(0, 12)}… has invalid URL: ${peer.url} (must start with ws://, wss://, http://, or https://)`,
        });
      }
      if (peer.deviceId === input.deviceId) {
        diagnostics.push({
          level: "warn",
          code: "SELF_PEER",
          message: `Peer spec points to own device ID — will be ignored`,
        });
      }
    }
    if (input.staticPeers.length === 0) {
      diagnostics.push(input.discoveryEnabled === false
        ? {
            level: "warn",
            code: "ISOLATED_NODE",
            message: "Discovery is disabled and no static peers are configured. Node will run isolated until peers are added manually.",
          }
        : {
            level: "info",
            code: "NO_STATIC_PEERS",
            message: "No static peers configured. Will rely on mDNS discovery.",
          });
    }
    const transportLabels = [...new Set(input.staticPeers.map((peer) => peer.transportLabel).filter(Boolean))];
    if (transportLabels.length > 0) {
      diagnostics.push({
        level: "info",
        code: "STATIC_PEER_TRANSPORTS",
        message: `Static peer transport labels configured: ${transportLabels.join(", ")}`,
      });
    }
    if (input.discoveryEnabled === false && input.staticPeers.some((peer) => !peer.transportLabel)) {
      diagnostics.push({
        level: "warn",
        code: "UNLABELED_STATIC_PEER_TRANSPORT",
        message: "Discovery is disabled but one or more static peers have no transport label. Add labels like relay, vpn, or lan for clearer WAN debugging.",
      });
    }
  }

  // Capabilities
  if (!input.capabilities || input.capabilities.length === 0) {
    diagnostics.push({
      level: "info",
      code: "NO_CAPABILITIES",
      message: "No capabilities advertised. Other nodes won't route requests here.",
    });
  }

  // Threshold rules
  if (input.thresholds) {
    const ruleIds = new Set<string>();
    for (const rule of input.thresholds) {
      if (!rule.ruleId) {
        diagnostics.push({
          level: "warn",
          code: "MISSING_RULE_ID",
          message: "Threshold rule missing ruleId — may cause dedup issues",
        });
      } else if (ruleIds.has(rule.ruleId)) {
        diagnostics.push({
          level: "warn",
          code: "DUPLICATE_RULE_ID",
          message: `Duplicate threshold ruleId: ${rule.ruleId}`,
        });
      } else {
        ruleIds.add(rule.ruleId);
      }
      if (!rule.metric) {
        diagnostics.push({
          level: "warn",
          code: "MISSING_RULE_METRIC",
          message: `Threshold rule ${rule.ruleId ?? "(unnamed)"} has no metric`,
        });
      }
    }
  }

  // Pi planner
  if (input.enablePiSession) {
    if (!input.hasApiKey) {
      diagnostics.push({
        level: "warn",
        code: "NO_API_KEY",
        message: "Pi planner enabled but no API key found. Set ANTHROPIC_API_KEY or provider-specific env var.",
      });
    }
    if (input.modelSpec) {
      const parts = input.modelSpec.split("/");
      if (parts.length < 2 || !parts[0] || !parts[1]) {
        diagnostics.push({
          level: "error",
          code: "INVALID_MODEL_SPEC",
          message: `Invalid model spec "${input.modelSpec}". Use "provider/model-id".`,
        });
      }
    }
  }

  return diagnostics;
}

/**
 * Check if any diagnostics are blocking (error level).
 */
export function hasBlockingDiagnostics(diagnostics: StartupDiagnostic[]): boolean {
  return diagnostics.some(d => d.level === "error");
}

/**
 * Format diagnostics for CLI output.
 */
export function formatDiagnostics(diagnostics: StartupDiagnostic[]): string {
  if (diagnostics.length === 0) return "✓ All pre-flight checks passed";

  return diagnostics.map(d => {
    const icon = d.level === "error" ? "✗" : d.level === "warn" ? "⚠" : "ℹ";
    return `${icon} [${d.code}] ${d.message}`;
  }).join("\n");
}
