import type { ContextFrame, MeshPeer, MeshRuntimeHealth, MeshRuntimeStatus } from "./store";
import { formatRelativeTime } from "./runtime-telemetry";

export type TopologyVisualNodeType = "planner" | "brain" | "field" | "sensor";

export type TopologyGraphNode = {
  id: string;
  deviceId: string;
  label: string;
  type: TopologyVisualNodeType;
  status: "active" | "idle";
  capabilities: string[];
  contextSummary?: string;
  x: number;
  y: number;
  role?: string;
  transportLabel?: string;
  isLocal?: boolean;
};

export type TopologyGraphEdge = {
  id: string;
  source: string;
  target: string;
  status: "connected" | "configured";
  transportLabel?: string;
  outbound?: boolean;
};

export type FrameActivityBar = {
  key: string;
  label: string;
  count: number;
  tone: string;
};

export type ObservationStoreCard = {
  id: string;
  label: string;
  value: string;
  source: string;
  timeLabel: string;
};

export function buildTopologyGraph(params: {
  runtimeHealth: MeshRuntimeHealth | null;
  runtimeStatus: MeshRuntimeStatus | null;
  frames: ContextFrame[];
  peerDirectory?: Record<string, MeshPeer>;
}): { nodes: TopologyGraphNode[]; edges: TopologyGraphEdge[] } {
  const { runtimeHealth, runtimeStatus, frames, peerDirectory = {} } = params;
  const localDeviceId = runtimeStatus?.localDeviceId ?? runtimeHealth?.nodeId ?? "local-node";
  const localNodeId = `local:${localDeviceId}`;
  const connectedPeers = runtimeStatus?.peers ?? [];
  const configuredPeers = runtimeStatus?.configuredStaticPeers ?? runtimeHealth?.configuredStaticPeers ?? [];
  const connectedIds = new Set(connectedPeers.map((peer) => peer.deviceId));
  const latestFrames = latestFrameBySource(frames);

  const nodes: TopologyGraphNode[] = [];
  const edges: TopologyGraphEdge[] = [];

  const localCapabilities = runtimeHealth?.capabilities.local ?? [];
  nodes.push({
    id: localNodeId,
    deviceId: localDeviceId,
    label: runtimeHealth?.displayName ?? "local-node",
    type: inferVisualNodeType(runtimeStatus?.plannerActivity?.role ?? runtimeHealth?.plannerActivity?.role ?? runtimeHealth?.plannerMode ? "planner" : undefined, localCapabilities),
    status: "active",
    capabilities: localCapabilities,
    contextSummary: buildLocalContextSummary(runtimeHealth, runtimeStatus, latestFrames.get(localDeviceId)),
    x: 420,
    y: 80,
    role: runtimeStatus?.plannerActivity?.role ?? runtimeHealth?.plannerActivity?.role,
    isLocal: true,
  });

  const connectedLayout = layoutRow(connectedPeers.length, 320);
  connectedPeers.forEach((peer, index) => {
    const directoryPeer = peerDirectory[peer.deviceId];
    nodes.push({
      id: peer.deviceId,
      deviceId: peer.deviceId,
      label: peer.displayName ?? directoryPeer?.displayName ?? shortDeviceId(peer.deviceId),
      type: inferVisualNodeType(peer.role, directoryPeer?.capabilities ?? []),
      status: "active",
      capabilities: directoryPeer?.capabilities ?? [],
      contextSummary: buildPeerContextSummary(latestFrames.get(peer.deviceId), {
        fallback: `Connected via ${peer.transportLabel ?? "mesh"}`,
      }),
      x: connectedLayout[index] ?? 420,
      y: 300,
      role: peer.role,
      transportLabel: peer.transportLabel,
    });
    edges.push({
      id: `edge:${localNodeId}:${peer.deviceId}`,
      source: localNodeId,
      target: peer.deviceId,
      status: "connected",
      transportLabel: peer.transportLabel,
      outbound: peer.outbound,
    });
  });

  const configuredOnlyPeers = configuredPeers.filter((peer) => !connectedIds.has(peer.deviceId));
  const configuredLayout = layoutRow(configuredOnlyPeers.length, 320);
  configuredOnlyPeers.forEach((peer, index) => {
    const directoryPeer = peerDirectory[peer.deviceId];
    nodes.push({
      id: peer.deviceId,
      deviceId: peer.deviceId,
      label: directoryPeer?.displayName ?? shortDeviceId(peer.deviceId),
      type: inferVisualNodeType(directoryPeer?.role, directoryPeer?.capabilities ?? []),
      status: "idle",
      capabilities: directoryPeer?.capabilities ?? [],
      contextSummary: buildPeerContextSummary(latestFrames.get(peer.deviceId), {
        fallback: `Configured ${peer.transportLabel ?? "static"} peer is offline`,
      }),
      x: configuredLayout[index] ?? 420,
      y: 520,
      role: directoryPeer?.role,
      transportLabel: peer.transportLabel,
    });
    edges.push({
      id: `edge:${localNodeId}:${peer.deviceId}`,
      source: localNodeId,
      target: peer.deviceId,
      status: "configured",
      transportLabel: peer.transportLabel,
      outbound: true,
    });
  });

  return { nodes, edges };
}

export function buildFrameActivityBars(frames: ContextFrame[], sampleSize = 60): FrameActivityBar[] {
  const sample = [...frames]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, sampleSize);

  const counts = new Map<string, number>();
  for (const frame of sample) {
    counts.set(frame.kind, (counts.get(frame.kind) ?? 0) + 1);
  }

  return [
    { key: "observation", label: "Observations", tone: "bg-mesh-info", count: counts.get("observation") ?? 0 },
    { key: "human_input", label: "Operator turns", tone: "bg-claw-accent", count: counts.get("human_input") ?? 0 },
    { key: "agent_response", label: "Planner replies", tone: "bg-mesh-active", count: counts.get("agent_response") ?? 0 },
    { key: "inference", label: "Reasoning", tone: "bg-white/55", count: counts.get("inference") ?? 0 },
  ];
}

export function buildObservationStores(
  frames: ContextFrame[],
  now = Date.now(),
  limit = 4,
): ObservationStoreCard[] {
  const latestByMetric = new Map<string, ContextFrame>();

  for (const frame of [...frames].sort((a, b) => b.timestamp - a.timestamp)) {
    if (frame.kind !== "observation") continue;
    const metric = String(frame.data?.metric ?? "metric");
    const zone = frame.data?.zone ? String(frame.data.zone) : "global";
    const source = frame.sourceDeviceId;
    const key = `${source}:${metric}:${zone}`;
    if (!latestByMetric.has(key)) {
      latestByMetric.set(key, frame);
    }
  }

  return [...latestByMetric.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .map((frame) => ({
      id: frame.frameId,
      label: buildObservationLabel(frame),
      value: String(frame.data?.value ?? "—"),
      source: frame.sourceDisplayName ?? shortDeviceId(frame.sourceDeviceId),
      timeLabel: formatRelativeTime(now - frame.timestamp),
    }));
}

function latestFrameBySource(frames: ContextFrame[]): Map<string, ContextFrame> {
  const result = new Map<string, ContextFrame>();
  for (const frame of [...frames].sort((a, b) => b.timestamp - a.timestamp)) {
    if (!result.has(frame.sourceDeviceId)) {
      result.set(frame.sourceDeviceId, frame);
    }
  }
  return result;
}

function buildLocalContextSummary(
  runtimeHealth: MeshRuntimeHealth | null,
  runtimeStatus: MeshRuntimeStatus | null,
  latestLocalFrame?: ContextFrame,
): string {
  const pending = runtimeStatus?.pendingProposals?.length ?? 0;
  if (pending > 0) {
    return `${pending} proposal${pending === 1 ? "" : "s"} awaiting review`;
  }

  if (latestLocalFrame) {
    return buildPeerContextSummary(latestLocalFrame, {
      fallback: `Planner ${runtimeHealth?.plannerMode ?? runtimeStatus?.plannerMode ?? "enabled"}`,
    });
  }

  const plannerMode = runtimeHealth?.plannerMode ?? runtimeStatus?.plannerMode;
  const model = runtimeHealth?.plannerModelSpec ?? runtimeStatus?.plannerModelSpec;
  if (plannerMode || model) {
    return [plannerMode ? `Planner ${plannerMode}` : null, model].filter(Boolean).join(" · ");
  }

  const entries = runtimeHealth?.worldModel.entries;
  return entries !== undefined ? `${entries} world-model entries loaded` : "Awaiting runtime state";
}

function buildPeerContextSummary(frame: ContextFrame | undefined, options: { fallback: string }): string {
  if (!frame) return options.fallback;

  switch (frame.kind) {
    case "observation": {
      const metric = String(frame.data?.metric ?? "metric");
      const value = frame.data?.value ?? "—";
      const zone = frame.data?.zone ? ` (${String(frame.data.zone)})` : "";
      return `${metric}: ${String(value)}${zone}`;
    }
    case "human_input":
      return truncate(String(frame.data?.intent ?? "Recent operator intent"), 72);
    case "agent_response": {
      const status = String(frame.data?.status ?? "response");
      const message = String(frame.data?.message ?? "").trim();
      return message ? truncate(message, 72) : `Planner ${status}`;
    }
    case "inference":
      return truncate(String(frame.data?.reasoning ?? frame.note ?? "Planner reasoning"), 72);
    default:
      return options.fallback;
  }
}

function inferVisualNodeType(role: string | undefined, capabilities: string[]): TopologyVisualNodeType {
  if (role === "planner" || role === "standby-planner") return "planner";
  if (role === "field") return "field";
  if (role === "sensor" || role === "actuator") return "sensor";
  if (capabilities.some((cap) => cap.startsWith("sensor:") || cap.startsWith("actuator:"))) return "sensor";
  return "brain";
}

function layoutRow(count: number, gap: number): number[] {
  if (count <= 0) return [];
  const centerX = 420;
  const midpoint = (count - 1) / 2;
  return Array.from({ length: count }, (_, index) => centerX + (index - midpoint) * gap);
}

function buildObservationLabel(frame: ContextFrame): string {
  const metric = String(frame.data?.metric ?? "metric");
  const zone = frame.data?.zone ? ` · ${String(frame.data.zone)}` : "";
  return `${metric}${zone}`;
}

function shortDeviceId(deviceId: string): string {
  return deviceId.length > 12 ? `${deviceId.slice(0, 12)}…` : deviceId;
}

function truncate(text: string, max = 72): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
