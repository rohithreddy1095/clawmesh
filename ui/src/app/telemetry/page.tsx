"use client";

import { Activity } from "lucide-react";

export default function TelemetryPage() {
    return (
        <div className="h-full w-full flex flex-col p-8">
            <div className="mb-6 z-10">
                <h1 className="text-4xl font-bold tracking-tight text-white flex items-center gap-3">
                    <Activity className="text-claw-accent" size={36} />
                    Telemetry & Discovery
                </h1>
                <p className="mt-2 text-foreground/60 font-mono text-sm max-w-xl">
                    Bonjour / mDNS discovery logs and mesh packet throughput over _clawmesh._tcp.
                </p>
            </div>

            <div className="flex-1 glass-panel p-6 flex flex-col relative z-10">
                <h2 className="text-sm font-semibold text-foreground/50 uppercase tracking-widest border-b border-white/5 pb-3 mb-6">
                    Network Throughput
                </h2>

                {/* Placeholder for actual chart lines */}
                <div className="flex-1 border-b border-l border-white/10 relative flex items-end opacity-70">
                    <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:20px_20px]" />

                    <svg className="w-full h-full preserve-3d absolute inset-0 text-claw-accent drop-shadow-[0_0_8px_rgba(255,90,45,0.8)]" preserveAspectRatio="none" viewBox="0 0 100 100">
                        <path stroke="currentColor" strokeWidth="0.5" fill="none" d="M0 80 Q 20 20 40 50 T 100 30" />
                        <path stroke="rgba(47,191,113,0.5)" strokeWidth="0.5" fill="none" d="M0 90 Q 25 70 50 85 T 100 60" />
                    </svg>
                </div>

                <div className="flex justify-between mt-4 text-xs font-mono text-foreground/50">
                    <span>-1hr</span>
                    <span>-30m</span>
                    <span>Now</span>
                </div>

                <div className="mt-8 grid grid-cols-3 gap-6">
                    <div className="bg-black/40 rounded-xl p-4 border border-white/5">
                        <div className="text-xs uppercase text-foreground/40 font-bold mb-1">Active Peers</div>
                        <div className="text-3xl font-mono text-white">4</div>
                    </div>
                    <div className="bg-black/40 rounded-xl p-4 border border-white/5">
                        <div className="text-xs uppercase text-foreground/40 font-bold mb-1">Mesh Envelopes/m</div>
                        <div className="text-3xl font-mono text-claw-accent">142</div>
                    </div>
                    <div className="bg-black/40 rounded-xl p-4 border border-white/5">
                        <div className="text-xs uppercase text-foreground/40 font-bold mb-1">Dropped Packets</div>
                        <div className="text-3xl font-mono text-mesh-active">0</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
