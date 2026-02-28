"use client";

import { TerminalSquare, Send, CheckCircle2, AlertTriangle, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export default function CommandPage() {
    const [command, setCommand] = useState("");

    return (
        <div className="h-full w-full flex flex-col p-8 max-w-6xl mx-auto">
            <div className="mb-6 z-10 flex items-center justify-between">
                <div>
                    <h1 className="text-4xl font-bold tracking-tight text-white flex items-center gap-3">
                        <TerminalSquare className="text-claw-accent" size={36} />
                        Command Center
                    </h1>
                    <p className="mt-2 text-foreground/60 font-mono text-sm">
                        Execute mesh capabilities and review high-risk tasks.
                    </p>
                </div>
            </div>

            <div className="flex gap-6 flex-1 min-h-0 relative z-10">
                <div className="flex-1 flex flex-col gap-4">
                    <div className="glass-panel flex-1 p-6 flex flex-col overflow-hidden">
                        <h2 className="text-sm font-semibold text-foreground/50 uppercase tracking-widest border-b border-white/5 pb-3 mb-4">
                            Execution Feed
                        </h2>

                        <div className="flex-1 overflow-y-auto space-y-4 pr-4">
                            <div className="bg-white/5 border border-white/5 rounded-xl p-4">
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle2 className="text-mesh-active" size={18} />
                                        <span className="font-semibold">Weather Node Sync</span>
                                    </div>
                                    <span className="text-xs font-mono text-foreground/40">10:45 AM</span>
                                </div>
                                <p className="text-sm text-foreground/70">Completed reading sequence. Pushed environment state to Mac-planner.</p>
                            </div>

                            <div className="bg-mesh-alert/10 border-l-4 border-l-mesh-alert border-y border-r border-y-mesh-alert/20 border-r-mesh-alert/20 rounded-r-xl p-4 shadow-[0_0_15px_rgba(226,61,45,0.15)]">
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2 text-mesh-alert">
                                        <ShieldAlert size={18} />
                                        <span className="font-bold">Human Verification Required (L3)</span>
                                    </div>
                                    <span className="text-xs font-mono text-foreground/40">10:52 AM</span>
                                </div>
                                <p className="text-sm text-foreground/80 mb-4">Jetson Nano proposed an emergency 30-min irrigation flush for Zone 1 due to critical moisture drop.</p>
                                <div className="bg-black/40 rounded-lg p-3 font-mono text-xs text-mesh-warn mb-4">
                                    {'>>'} Target: actuator:pump:P1<br />
                                    {'>>'} Duration: 1800s<br />
                                    {'>>'} Requester: jetson-field-01
                                </div>
                                <div className="flex gap-3">
                                    <button className="bg-mesh-active hover:bg-mesh-active/80 text-black font-bold px-4 py-2 rounded-lg text-sm transition-colors">
                                        APPROVE EXECUTION
                                    </button>
                                    <button className="bg-white/10 hover:bg-white/20 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors">
                                        REJECT
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="glass-panel p-4 flex gap-3 items-center ring-1 ring-white/10 focus-within:ring-claw-accent/50 focus-within:shadow-[0_0_20px_rgba(255,90,45,0.2)] transition-all">
                        <TerminalSquare className="text-claw-accent" />
                        <input
                            type="text"
                            placeholder="E.g., Ask Jetson to propose an irrigation schedule based on current soil data..."
                            className="flex-1 bg-transparent border-none outline-none text-white placeholder-white/30 font-mono text-sm"
                            value={command}
                            onChange={(e) => setCommand(e.target.value)}
                        />
                        <button className="bg-claw-accent hover:bg-claw-accent-bright text-white p-2 rounded-xl transition-colors">
                            <Send size={18} />
                        </button>
                    </div>
                </div>

                <div className="w-80 glass-panel p-6 flex flex-col">
                    <h2 className="text-sm font-semibold text-foreground/50 uppercase tracking-widest border-b border-white/5 pb-3 mb-4">
                        Available Targets
                    </h2>
                    <div className="space-y-2">
                        <div className="p-2 rounded-lg bg-white/5 border border-white/10 flex justify-between items-center group cursor-pointer hover:border-claw-accent/50">
                            <span className="font-mono text-xs text-foreground/80">mac-planner</span>
                            <div className="h-2 w-2 rounded-full bg-mesh-active" />
                        </div>
                        <div className="p-2 rounded-lg bg-white/5 border border-white/10 flex justify-between items-center group cursor-pointer hover:border-claw-accent/50">
                            <span className="font-mono text-xs text-foreground/80">jetson-field-01</span>
                            <div className="h-2 w-2 rounded-full bg-mesh-active" />
                        </div>
                        <div className="p-2 rounded-lg bg-white/5 border border-white/10 flex justify-between items-center group cursor-pointer hover:border-claw-accent/50">
                            <span className="font-mono text-xs text-foreground/80">field-node-water-01</span>
                            <div className="h-2 w-2 rounded-full bg-mesh-active" />
                        </div>
                    </div>

                    <h2 className="text-sm font-semibold text-foreground/50 uppercase tracking-widest border-b border-white/5 pb-3 mt-8 mb-4">
                        Trust Status
                    </h2>
                    <div className="flex items-center gap-3 bg-mesh-active/10 text-mesh-active text-xs font-mono p-3 rounded-lg border border-mesh-active/20">
                        <CheckCircle2 size={16} /> Identity Signature Valid
                    </div>
                </div>
            </div>
        </div>
    );
}
