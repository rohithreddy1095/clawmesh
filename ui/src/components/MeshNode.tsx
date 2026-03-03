"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { cn } from "@/lib/utils";
import { Cpu, Server, Sprout, Network, Activity } from "lucide-react";

export type MeshNodeType = "planner" | "brain" | "field" | "sensor";
export type MeshNodeData = {
    label: string;
    deviceId: string;
    type: MeshNodeType;
    status: "active" | "idle";
    capabilities?: string[];
    contextSummary?: string;
};

const ICONS = {
    planner: Server,
    brain: Cpu,
    field: Network,
    sensor: Sprout,
};

const COLORS = {
    planner: "border-claw-accent/70 shadow-[0_0_18px_rgba(255,120,68,0.24)]",
    brain: "border-mesh-info/70 shadow-[0_0_18px_rgba(69,176,203,0.22)]",
    field: "border-[#7aa2ff]/70 shadow-[0_0_18px_rgba(122,162,255,0.22)]",
    sensor: "border-mesh-active/70 shadow-[0_0_18px_rgba(90,216,127,0.22)]",
};

export const MeshNode = memo(({ data, selected }: NodeProps<MeshNodeData>) => {
    const Icon = ICONS[data.type as MeshNodeType] || Server;
    const borderColor = COLORS[data.type as MeshNodeType];

    return (
        <div
            className={cn(
                "relative w-72 rounded-[1.35rem] border bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.02))] p-4 backdrop-blur-xl transition-all duration-300",
                borderColor,
                selected ? "scale-[1.03] ring-2 ring-white/40" : "hover:border-white/20 hover:shadow-[0_0_22px_rgba(255,255,255,0.08)]"
            )}
        >
            <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
            <Handle type="target" position={Position.Top} className="h-3 w-3 border-white/10 bg-foreground/20" />
            <Handle type="source" position={Position.Bottom} className="h-3 w-3 border-white/10 bg-foreground/20" />

            <div className="mb-4 flex items-center justify-between gap-3">
                <div className="rounded-full border border-white/8 bg-black/20 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/45">
                    {data.type}
                </div>
                <div
                    className={cn(
                        "h-2.5 w-2.5 rounded-full shadow-[0_0_12px_currentColor]",
                        data.status === "active" ? "bg-mesh-active text-mesh-active" : "bg-neutral-600 text-neutral-600"
                    )}
                />
            </div>

            <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-2.5 text-foreground">
                        <Icon size={20} />
                    </div>
                    <div>
                        <div className="leading-tight font-semibold text-foreground">{data.label}</div>
                        <div className="font-mono text-[10px] tracking-[0.2em] text-foreground/45">
                            {data.deviceId}
                        </div>
                    </div>
                </div>
            </div>

            {data.capabilities && data.capabilities.length > 0 && (
                <div className="mt-4 flex flex-col gap-2">
                    <div className="pl-1 text-[10px] font-medium uppercase tracking-[0.24em] text-foreground/40">Capabilities</div>
                    <div className="flex flex-wrap gap-1.5">
                        {data.capabilities.map((cap: string) => (
                            <span
                                key={cap}
                                className="rounded-full border border-white/8 bg-white/[0.045] px-2.5 py-1 font-mono text-[9px] leading-none text-foreground/80"
                            >
                                {cap}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {data.contextSummary && (
                <div className="mt-4 rounded-2xl border border-white/8 bg-black/25 p-3">
                    <div className="mb-1.5 flex items-center gap-1 text-[9px] font-medium uppercase tracking-[0.24em] text-claw-accent/80">
                        <Activity className="w-3 h-3" /> Live Context
                    </div>
                    <div className="font-mono text-[11px] leading-tight text-foreground/80">
                        {data.contextSummary}
                    </div>
                </div>
            )}
        </div>
    );
});

MeshNode.displayName = "MeshNode";
