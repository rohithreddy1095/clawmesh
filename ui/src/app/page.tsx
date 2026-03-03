"use client";

import ReactFlow, {
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  Edge,
  Node,
  BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { MeshNode } from '@/components/MeshNode';
import { ArrowUpRight, Network, ShieldCheck, Sparkles, Waves } from 'lucide-react';

const nodeTypes = {
  meshNode: MeshNode,
};

// Initial mock data simulating the Sovereign Mesh
const initialNodes: Node[] = [
  {
    id: 'mac-planner',
    type: 'meshNode',
    position: { x: 400, y: 100 },
    data: {
      label: 'Mac Studio (Planner)',
      deviceId: 'a8b7c6d5...',
      type: 'planner',
      status: 'active',
      capabilities: ['llm:planner', 'repo-access:bhoomi'],
      contextSummary: 'Workspace dirty: 2 files modified in /farm/zones'
    },
  },
  {
    id: 'jetson-field-01',
    type: 'meshNode',
    position: { x: 300, y: 350 },
    data: {
      label: 'Jetson Nano (Field Brain)',
      deviceId: 'e1f2g3h4...',
      type: 'brain',
      status: 'active',
      capabilities: ['vision:plant-health', 'safety:interlock', 'exec:workflow'],
      contextSummary: 'Irrigation task blocked awaiting human verification'
    },
  },
  {
    id: 'field-node-water-01',
    type: 'meshNode',
    position: { x: 100, y: 550 },
    data: {
      label: 'Water Node 01',
      deviceId: 'j5k6l7m8...',
      type: 'sensor',
      status: 'active',
      capabilities: ['sensor:tank-level', 'actuator:pump', 'actuator:valve'],
      contextSummary: 'Tank level: 85% | Pump: OFF'
    },
  },
  {
    id: 'field-node-weather-01',
    type: 'meshNode',
    position: { x: 500, y: 550 },
    data: {
      label: 'Weather Node 01',
      deviceId: 'n9o0p1q2...',
      type: 'sensor',
      status: 'active',
      capabilities: ['sensor:rain', 'sensor:air-temp', 'sensor:humidity'],
      contextSummary: 'Temp: 32°C | Humidity: 65%'
    },
  },
];

const initialEdges: Edge[] = [
  { id: 'e1-2', source: 'mac-planner', target: 'jetson-field-01', animated: true, style: { stroke: 'rgba(255,90,45,0.6)', strokeWidth: 2 } },
  { id: 'e2-3', source: 'jetson-field-01', target: 'field-node-water-01', animated: true, style: { stroke: 'rgba(255,255,255,0.2)', strokeWidth: 2 } },
  { id: 'e2-4', source: 'jetson-field-01', target: 'field-node-weather-01', style: { stroke: 'rgba(255,255,255,0.2)', strokeWidth: 2 } },
];

const statusCards = [
  { label: 'Active Peers', value: '04', detail: 'Planner, field brain, and two sensor nodes', tone: 'text-white' },
  { label: 'Context Drift', value: '0.18s', detail: 'Median propagation across the latest gossip cycle', tone: 'text-claw-accent' },
  { label: 'Trust Health', value: '100%', detail: 'Signed envelopes and heartbeat checks passing', tone: 'text-mesh-active' },
];

const signalFeed = [
  {
    node: 'mac-planner',
    summary: 'Planner rebased the execution graph after zone moisture dipped below the safety threshold.',
    time: 'Just now',
    accent: 'text-claw-accent',
  },
  {
    node: 'jetson-field-01',
    summary: 'Field brain accepted a new intent envelope and is staging a constrained irrigation proposal.',
    time: '12s ago',
    accent: 'text-mesh-info',
  },
  {
    node: 'field-node-water-01',
    summary: 'Pump and valve remain idle while reserve stays above the minimum buffer.',
    time: '1m ago',
    accent: 'text-mesh-active',
  },
];

const handoffSteps = [
  { title: 'Sense', body: 'Water and weather nodes publish fresh observations into the mesh.' },
  { title: 'Plan', body: 'The planner merges local repo context with current field conditions.' },
  { title: 'Verify', body: 'High-risk envelopes stay gated until an operator approves execution.' },
];

export default function MeshTopologyPage() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-6">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <div className="glass-panel relative overflow-hidden p-6 sm:p-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,120,68,0.12),transparent_26%),radial-gradient(circle_at_18%_24%,rgba(69,176,203,0.1),transparent_24%)]"
          />
          <div className="relative">
            <p className="section-label">Operator Surface</p>
            <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.22em] text-foreground/60">
                  <Sparkles className="h-3.5 w-3.5 text-claw-accent" />
                  Live Capability Routing
                </div>
                <h1 className="mt-4 flex items-center gap-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                  <Network className="text-claw-accent" size={38} />
                  Sovereign Mesh
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-foreground/65 sm:text-base">
                  A command-grade view of device trust, field state, and context gossip. Operator intent stays
                  close to the mesh while every sensitive transition remains visible.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 lg:max-w-xl">
                {statusCards.map((card) => (
                  <div key={card.label} className="metric-card">
                    <p className="section-label">{card.label}</p>
                    <p className={`mt-2 text-2xl font-semibold tracking-tight ${card.tone}`}>{card.value}</p>
                    <p className="mt-2 text-xs leading-5 text-foreground/55">{card.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="glass-panel p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="section-label">Execution Chain</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Intent Handoff</h2>
            </div>
            <div className="rounded-2xl border border-claw-accent/20 bg-claw-accent/10 p-2 text-claw-accent">
              <ArrowUpRight className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {handoffSteps.map((step, index) => (
              <div key={step.title} className="flex gap-4 rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-black/20 font-mono text-xs text-foreground/60">
                  0{index + 1}
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-tight text-white">{step.title}</p>
                  <p className="mt-1 text-sm leading-6 text-foreground/60">{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid flex-1 gap-6 xl:grid-cols-[minmax(0,1.45fr)_360px]">
        <div className="glass-panel flex min-h-[520px] flex-col overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-white/6 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="section-label">Live Graph</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Topology Map</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/60">
                _clawmesh._tcp
              </div>
              <div className="rounded-full border border-mesh-active/20 bg-mesh-active/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.2em] text-mesh-active">
                Signed Gossip Healthy
              </div>
            </div>
          </div>

          <div className="relative flex-1">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-[#0b1120] to-transparent"
            />
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              fitView
              className="bg-transparent"
              minZoom={0.55}
              maxZoom={1.35}
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
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Live Context Gossip</h2>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-2 text-foreground/60">
                <Waves className="h-5 w-5" />
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {signalFeed.map((entry) => (
                <div key={`${entry.node}-${entry.time}`} className="rounded-2xl border border-white/6 bg-white/[0.035] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`font-mono text-[11px] uppercase tracking-[0.22em] ${entry.accent}`}>{entry.node}</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/35">{entry.time}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-foreground/70">{entry.summary}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel p-6">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl border border-mesh-active/20 bg-mesh-active/10 text-mesh-active">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <p className="section-label">Trust Layer</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-white">Verified Control Plane</h2>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                <p className="section-label">Identity</p>
                <p className="mt-2 text-sm font-medium text-white">Ed25519 signatures valid on every active peer.</p>
              </div>
              <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                <p className="section-label">Escalation</p>
                <p className="mt-2 text-sm font-medium text-white">L3 tasks require explicit human approval before actuation.</p>
              </div>
              <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                <p className="section-label">Routing</p>
                <p className="mt-2 text-sm font-medium text-white">Capabilities resolve to the closest trusted peer first.</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
