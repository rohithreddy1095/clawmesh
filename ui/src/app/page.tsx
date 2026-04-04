"use client";

import { useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  type Edge,
  type Node,
  BackgroundVariant,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  Activity,
  BrainCircuit,
  Database,
  Network,
  Radio,
  ShieldCheck,
  Waves,
} from "lucide-react";

import { MeshNode, type MeshNodeData } from "@/components/MeshNode";
import { useMesh } from "@/lib/useMesh";
import { useMeshStore } from "@/lib/store";
import {
  buildFrameActivityBars,
  buildObservationStores,
  buildTopologyGraph,
} from "@/lib/runtime-topology";
import {
  buildRuntimeTimeline,
  buildSystemEventTimeline,
  formatRelativeTime,
} from "@/lib/runtime-telemetry";

const nodeTypes = {
  meshNode: MeshNode,
};

function edgeStyle(status: "connected" | "configured") {
  return status === "connected"
    ? { stroke: "rgba(255,120,68,0.7)", strokeWidth: 2.4 }
    : { stroke: "rgba(255,255,255,0.22)", strokeWidth: 1.8, strokeDasharray: "8 6" };
}

export default function MeshTopologyPage() {
  const { isConnected } = useMesh();
  const { runtimeHealth, runtimeStatus, runtimeEvents, frames, peers } = useMeshStore();

  const topology = useMemo(
    () => buildTopologyGraph({ runtimeHealth, runtimeStatus, frames, peerDirectory: peers }),
    [runtimeHealth, runtimeStatus, frames, peers],
  );
  const frameActivity = useMemo(() => buildFrameActivityBars(frames, 60), [frames]);
  const observationStores = useMemo(() => buildObservationStores(frames, Date.now(), 5), [frames]);
  const runtimeFeed = useMemo(() => {
    const live = buildRuntimeTimeline(frames, Date.now(), 8);
    return live.length > 0 ? live : buildSystemEventTimeline(runtimeEvents, Date.now(), 8);
  }, [frames, runtimeEvents]);

  const flowNodes = useMemo<Node<MeshNodeData>[]>(
    () => topology.nodes.map((node) => ({
      id: node.id,
      type: "meshNode",
      position: { x: node.x, y: node.y },
      data: {
        label: node.label,
        deviceId: node.deviceId,
        type: node.type,
        status: node.status,
        capabilities: node.capabilities,
        contextSummary: node.contextSummary,
      },
      draggable: false,
      selectable: true,
    })),
    [topology.nodes],
  );
  const flowEdges = useMemo<Edge[]>(
    () => topology.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      animated: edge.status === "connected",
      style: edgeStyle(edge.status),
      label: edge.transportLabel,
      labelStyle: { fill: "rgba(255,255,255,0.55)", fontSize: 10, textTransform: "uppercase" },
    })),
    [topology.edges],
  );

  const latestHeartbeat = runtimeHealth?.timestamp
    ? formatRelativeTime(Date.now() - new Date(runtimeHealth.timestamp).getTime())
    : "awaiting heartbeat";
  const connectedPeers = runtimeStatus?.connectedPeers ?? runtimeHealth?.peers.connected ?? 0;
  const pendingProposals = runtimeStatus?.pendingProposals?.length ?? 0;
  const maxFrameBar = Math.max(1, ...frameActivity.map((item) => item.count));
  const totalNodes = topology.nodes.length;

  const topCards = [
    {
      label: "Mesh Link",
      value: isConnected ? "Connected" : "Offline",
      detail: latestHeartbeat,
      icon: Radio,
      tone: isConnected ? "text-mesh-active" : "text-mesh-alert",
    },
    {
      label: "Visible Nodes",
      value: String(totalNodes),
      detail: `${connectedPeers} connected · ${topology.edges.length} links`,
      icon: Network,
      tone: "text-white",
    },
    {
      label: "World Model",
      value: String(runtimeHealth?.worldModel.entries ?? 0),
      detail: `${runtimeHealth?.worldModel.frameLogSize ?? 0} recent frames cached`,
      icon: Database,
      tone: "text-claw-accent",
    },
    {
      label: "Planner Lane",
      value: runtimeHealth?.plannerMode ?? runtimeStatus?.plannerMode ?? "disabled",
      detail: pendingProposals > 0 ? `${pendingProposals} pending proposals` : "No pending proposals",
      icon: BrainCircuit,
      tone: pendingProposals > 0 ? "text-claw-accent" : "text-white",
    },
  ];

  const plannerFacts = [
    { label: "Node", value: runtimeHealth?.displayName ?? runtimeStatus?.localDeviceId ?? "unknown" },
    { label: "Model", value: runtimeHealth?.plannerModelSpec ?? runtimeStatus?.plannerModelSpec ?? "unknown" },
    {
      label: "Leader",
      value: runtimeHealth?.plannerLeader?.deviceId
        ? `${runtimeHealth.plannerLeader.kind}:${runtimeHealth.plannerLeader.role ?? "node"}:${runtimeHealth.plannerLeader.deviceId}`
        : "none",
    },
    {
      label: "Capabilities",
      value: `${runtimeHealth?.capabilities.local.length ?? 0} local · ${runtimeHealth?.capabilities.meshTotal ?? 0} mesh`,
    },
  ];

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-6">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_360px]">
        <div className="glass-panel relative overflow-hidden p-6 sm:p-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,120,68,0.12),transparent_24%),radial-gradient(circle_at_18%_24%,rgba(69,176,203,0.1),transparent_24%)]"
          />
          <div className="relative">
            <p className="section-label">Operator Surface</p>
            <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.22em] text-foreground/60">
                  <Activity className="h-3.5 w-3.5 text-claw-accent" />
                  Live Mesh Topology
                </div>
                <h1 className="mt-4 flex items-center gap-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                  <Network className="text-claw-accent" size={38} />
                  Real-Time Mesh Graph
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-foreground/65 sm:text-base">
                  This surface is now driven by live runtime data from <code>mesh.status</code>, <code>mesh.health</code>,
                  backend events, and context frames. Connected peers, offline configured peers, latest observations,
                  and planner state are all rendered from backend truth.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl xl:grid-cols-4">
                {topCards.map((card) => {
                  const Icon = card.icon;
                  return (
                    <div key={card.label} className="metric-card">
                      <div className="flex items-center justify-between gap-3">
                        <p className="section-label">{card.label}</p>
                        <Icon className={card.tone} size={16} />
                      </div>
                      <p className={`mt-2 text-2xl font-semibold tracking-tight ${card.tone}`}>{card.value}</p>
                      <p className="mt-2 text-xs leading-5 text-foreground/55">{card.detail}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="glass-panel p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="section-label">Planner Snapshot</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Backend Truth</h2>
            </div>
            <div className="rounded-2xl border border-claw-accent/20 bg-claw-accent/10 p-2 text-claw-accent">
              <ShieldCheck className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {plannerFacts.map((fact) => (
              <div key={fact.label} className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                <p className="section-label">{fact.label}</p>
                <p className="mt-2 text-sm font-medium break-all text-white">{fact.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid flex-1 gap-6 xl:grid-cols-[minmax(0,1.5fr)_380px]">
        <div className="glass-panel flex min-h-[620px] flex-col overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-white/6 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="section-label">Live Graph</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Topology Map</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="rounded-full border border-mesh-active/20 bg-mesh-active/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.2em] text-mesh-active">
                connected link
              </div>
              <div className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/60">
                configured offline
              </div>
            </div>
          </div>

          <div className="relative flex-1">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-[#0b1120] to-transparent"
            />
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              fitView
              className="bg-transparent"
              minZoom={0.45}
              maxZoom={1.35}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={2} color="rgba(255,255,255,0.05)" />
              <Controls className="!bottom-5 !left-5 !border-white/8 !bg-black/50 !shadow-none [&_button]:!border-white/8 [&_button]:!bg-white/[0.04] [&_button]:!text-white" showInteractive={false} />
            </ReactFlow>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="glass-panel flex flex-col p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="section-label">Mesh Chatter</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Live Context Feed</h2>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-2 text-foreground/60">
                <Waves className="h-5 w-5" />
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {runtimeFeed.length === 0 ? (
                <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4 text-sm text-foreground/50">
                  Waiting for backend runtime activity…
                </div>
              ) : (
                runtimeFeed.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-white/6 bg-white/[0.035] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className={`font-mono text-[11px] uppercase tracking-[0.22em] ${entry.tone}`}>{entry.title}</span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/35">{entry.timeLabel}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-foreground/70 whitespace-pre-wrap">{entry.detail}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="glass-panel p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="section-label">Field Stores</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Latest Observations</h2>
              </div>
              <div className="rounded-2xl border border-mesh-info/20 bg-mesh-info/10 p-2 text-mesh-info">
                <Database className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {observationStores.length === 0 ? (
                <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4 text-sm text-foreground/50">
                  No live observations in the current frame window.
                </div>
              ) : (
                observationStores.map((card) => (
                  <div key={card.id} className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-mesh-info">{card.label}</span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/35">{card.timeLabel}</span>
                    </div>
                    <p className="mt-2 text-2xl font-semibold tracking-tight text-white">{card.value}</p>
                    <p className="mt-2 text-xs text-foreground/50">{card.source}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="glass-panel p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="section-label">Activity Mix</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Recent Frame Types</h2>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-2 text-foreground/60">
                <Activity className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {frameActivity.map((item) => (
                <div key={item.key} className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-white">{item.label}</span>
                    <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground/45">{item.count}</span>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-white/8">
                    <div
                      className={`h-2 rounded-full ${item.tone}`}
                      style={{ width: `${Math.max((item.count / maxFrameBar) * 100, item.count > 0 ? 8 : 0)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
