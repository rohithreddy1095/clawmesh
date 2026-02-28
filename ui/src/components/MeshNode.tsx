"use client";

import { memo } from "react";
import { Handle, Position } from "reactflow";
import { cn } from "@/lib/utils";
import { Cpu, Server, Sprout, Network, Activity } from "lucide-react";

export type MeshNodeType = "planner" | "brain" | "field" | "sensor";

const ICONS = {
    planner: Server,
    brain: Cpu,
    field: Network,
    sensor: Sprout,
};

const COLORS = {
    planner: "border-claw-accent shadow-[0_0_15px_rgba(255,90,45,0.4)]",
    brain: "border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.4)]",
    field: "border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.4)]",
    sensor: "border-mesh-active shadow-[0_0_15px_rgba(47,191,113,0.4)]",
};

export const MeshNode = memo(({ data, selected }: any) => {
    const Icon = ICONS[data.type as MeshNodeType] || Server;
    const borderColor = COLORS[data.type as MeshNodeType];

    return (
        <div
            className={cn(
                "relative rounded-xl border-2 bg-panel-bg p-4 backdrop-blur-md transition-all duration-300 w-64",
                borderColor,
                selected ? "ring-2 ring-white/50 scale-105" : "hover:shadow-[0_0_20px_rgba(255,255,255,0.1)]"
            )}
        >
            <Handle type="target" position={Position.Top} className="w-3 h-3 bg-foreground/20 border-border" />
            <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-foreground/20 border-border" />

            <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-white/5 p-2 text-foreground">
                        <Icon size={20} />
                    </div>
                    <div>
                        <div className="font-semibold text-foreground leading-tight">{data.label}</div>
                        <div className="font-mono text-[10px] text-foreground/50 tracking-wider">
                            {data.deviceId}
                        </div>
                    </div>
                </div>
                <div
                    className={cn(
                        "h-2 w-2 rounded-full",
                        data.status === "active" ? "bg-mesh-active animate-pulse" : "bg-neutral-600"
                    )}
                />
            </div>

            {data.capabilities && data.capabilities.length > 0 && (
                <div className="mt-4 flex flex-col gap-1.5">
                    <div className="text-[10px] font-medium text-foreground/40 uppercase tracking-widest pl-1">Capabilities</div>
                    <div className="flex flex-wrap gap-1.5">
                        {data.capabilities.map((cap: string) => (
                            <span
                                key={cap}
                                className="rounded-md bg-white/5 border border-white/10 px-2 py-0.5 font-mono text-[9px] text-foreground/80 leading-none"
                            >
                                {cap}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {data.contextSummary && (
                <div className="mt-3 rounded-lg bg-black/40 p-2 border border-white/5">
                    <div className="text-[9px] font-medium text-claw-accent/80 mb-1 flex items-center gap-1 uppercase tracking-widest">
                        <Activity className="w-3 h-3" /> Live Context
                    </div>
                    <div className="text-[11px] text-foreground/80 font-mono leading-tight">
                        {data.contextSummary}
                    </div>
                </div>
            )}
        </div>
    );
});

MeshNode.displayName = "MeshNode";
