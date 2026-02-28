"use client";

import { useCallback } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Edge,
  Node,
  BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { MeshNode } from '@/components/MeshNode';
import { Network } from 'lucide-react';

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

export default function MeshTopologyPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div className="h-full w-full relative">
      {/* Header Overlay */}
      <div className="absolute top-8 left-8 z-10 pointer-events-none">
        <h1 className="text-4xl font-bold tracking-tight text-white flex items-center gap-3">
          <Network className="text-claw-accent" size={36} />
          Sovereign Mesh
        </h1>
        <p className="mt-2 text-foreground/60 font-mono text-sm max-w-md bg-black/40 p-2 rounded-md backdrop-blur-sm border border-white/5">
          Live capabilities and context propagation. Devices auto-discover via _clawmesh._tcp.
        </p>
      </div>

      {/* Right Panel Overlay - Mesh Activity Log */}
      <div className="absolute top-8 right-8 bottom-8 w-80 z-10 bg-panel-bg backdrop-blur-md border border-panel-border rounded-xl shadow-2xl p-4 flex flex-col pointer-events-auto">
        <h2 className="text-sm font-semibold text-foreground/80 uppercase tracking-widest border-b border-white/10 pb-2 mb-4">
          Live Context Gossip
        </h2>
        <div className="flex-1 overflow-auto space-y-3 pr-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          <div className="text-xs bg-white/5 p-2 rounded-md border border-white/5">
            <div className="text-claw-accent font-mono mb-1">mac-planner</div>
            <div className="text-foreground/80">Context changed: Workspace dirty: 2 files modified in /farm/zones</div>
            <div className="text-foreground/40 text-[10px] mt-1 text-right">Just now</div>
          </div>
          <div className="text-xs bg-white/5 p-2 rounded-md border border-white/5">
            <div className="text-blue-400 font-mono mb-1">jetson-field-01</div>
            <div className="text-foreground/80">Command Envelop received: Evaluate irrigation constraints vs Mac planner state.</div>
            <div className="text-foreground/40 text-[10px] mt-1 text-right">12s ago</div>
          </div>
          <div className="text-xs bg-white/5 p-2 rounded-md border border-white/5">
            <div className="text-mesh-active font-mono mb-1">field-node-water-01</div>
            <div className="text-foreground/80">Status heartbeat. Tank level holding at 85%.</div>
            <div className="text-foreground/40 text-[10px] mt-1 text-right">1m ago</div>
          </div>
        </div>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        className="bg-transparent"
        minZoom={0.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={2} color="rgba(255,255,255,0.05)" />
        <Controls className="bg-black/80 border-white/10 fill-white" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
