"use client";

import {
    ChevronRight,
    Radar,
    Send,
    TerminalSquare,
    Wifi,
    WifiOff,
    Shield,
    Users,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useMesh } from "@/lib/useMesh";
import { useMeshStore } from "@/lib/store";
import { ChatMessage } from "@/components/ChatMessage";
import { ProposalCard } from "@/components/ProposalCard";

const quickIntents = [
    "How's my farm doing?",
    "What are the current soil moisture levels?",
    "Start the motor in zone 1",
    "Summarize the last 15 minutes of sensor data",
];

export default function CommandPage() {
    const { isConnected, sendChat, approveProposal, rejectProposal } = useMesh();
    const { chatMessages, peers, proposals } = useMeshStore();
    const [input, setInput] = useState("");
    const chatEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [chatMessages]);

    const handleSend = (text?: string) => {
        const msgText = text || input.trim();
        if (!msgText) return;
        sendChat(msgText);
        setInput("");
        inputRef.current?.focus();
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        handleSend();
    };

    // Find proposals referenced in chat messages
    const getInlineProposals = (proposalIds?: string[]) => {
        if (!proposalIds) return [];
        return proposalIds
            .map((id) => proposals[id])
            .filter(Boolean);
    };

    const peerList = Object.values(peers);
    const pendingProposals = Object.values(proposals).filter(
        (p) => p.status === "proposed" || p.status === "awaiting_approval"
    );

    return (
        <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-4">
            {/* Header */}
            <section className="glass-panel relative overflow-hidden px-6 py-5">
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,120,68,0.10),transparent_24%),radial-gradient(circle_at_20%_28%,rgba(69,176,203,0.08),transparent_24%)]"
                />
                <div className="relative flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <TerminalSquare className="text-claw-accent" size={28} />
                        <div>
                            <h1 className="text-2xl font-semibold tracking-tight text-white">
                                Command Center
                            </h1>
                            <p className="text-xs text-foreground/50">
                                Talk to your farm intelligence layer
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {pendingProposals.length > 0 && (
                            <div className="rounded-full border border-mesh-warn/20 bg-mesh-warn/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-mesh-warn">
                                {pendingProposals.length} pending
                            </div>
                        )}
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5">
                            <span className="relative flex h-2.5 w-2.5">
                                <span
                                    className={cn(
                                        "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                                        isConnected ? "bg-mesh-active" : "bg-mesh-alert"
                                    )}
                                />
                                <span
                                    className={cn(
                                        "relative inline-flex h-2.5 w-2.5 rounded-full",
                                        isConnected ? "bg-mesh-active" : "bg-mesh-alert"
                                    )}
                                />
                            </span>
                            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/55">
                                {isConnected ? "Connected" : "Offline"}
                            </span>
                        </div>
                    </div>
                </div>
            </section>

            {/* Main layout */}
            <section className="grid flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                {/* Chat column */}
                <div className="flex min-h-[640px] flex-col gap-4">
                    {/* Chat messages area */}
                    <div className="glass-panel flex flex-1 flex-col overflow-hidden">
                        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
                            {chatMessages.length === 0 && (
                                <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                                    <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                                        <TerminalSquare className="text-claw-accent/40" size={36} />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-foreground/50">
                                            No messages yet
                                        </p>
                                        <p className="mt-1 text-xs text-foreground/30">
                                            Type a message or pick a quick intent to get started
                                        </p>
                                    </div>
                                </div>
                            )}

                            {chatMessages.map((msg) => (
                                <div key={msg.id}>
                                    <ChatMessage message={msg} />

                                    {/* Inline proposals */}
                                    {msg.proposals && msg.proposals.length > 0 && (
                                        <div className="ml-11 mt-2 space-y-2">
                                            {getInlineProposals(msg.proposals).map((p) => (
                                                <ProposalCard
                                                    key={p.taskId}
                                                    proposal={p}
                                                    onApprove={approveProposal}
                                                    onReject={rejectProposal}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}

                            <div ref={chatEndRef} />
                        </div>
                    </div>

                    {/* Input */}
                    <form
                        onSubmit={handleSubmit}
                        className="glass-panel border border-white/6 p-4 transition-all focus-within:border-claw-accent/25"
                    >
                        <div className="flex items-center gap-3">
                            <div className="flex flex-1 items-center gap-3 rounded-2xl border border-white/6 bg-black/20 px-4 py-3">
                                <TerminalSquare className="shrink-0 text-claw-accent" size={16} />
                                <input
                                    ref={inputRef}
                                    type="text"
                                    placeholder="Ask about your farm, request sensor data, or give instructions..."
                                    className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/25"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={!input.trim() || !isConnected}
                                className="inline-flex items-center justify-center rounded-2xl bg-claw-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-claw-accent-bright disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <Send size={16} />
                            </button>
                        </div>
                    </form>
                </div>

                {/* Right sidebar */}
                <div className="flex flex-col gap-4">
                    {/* Quick Intents */}
                    <div className="glass-panel p-5">
                        <div className="flex items-center justify-between gap-3">
                            <p className="section-label">Quick Intents</p>
                            <Radar className="h-4 w-4 text-claw-accent/60" />
                        </div>
                        <div className="mt-3 space-y-2">
                            {quickIntents.map((intent) => (
                                <button
                                    key={intent}
                                    type="button"
                                    onClick={() => handleSend(intent)}
                                    disabled={!isConnected}
                                    className="flex w-full items-start justify-between gap-2 rounded-xl border border-white/6 bg-white/[0.03] px-3 py-3 text-left transition-colors hover:border-white/10 hover:bg-white/[0.05] disabled:opacity-40"
                                >
                                    <span className="text-xs leading-5 text-foreground/60">{intent}</span>
                                    <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-foreground/25" />
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Mesh Peers */}
                    <div className="glass-panel p-5">
                        <div className="flex items-center justify-between gap-3">
                            <p className="section-label">Mesh Peers</p>
                            <Users className="h-4 w-4 text-mesh-info/60" />
                        </div>
                        <div className="mt-3 space-y-2">
                            {peerList.length === 0 ? (
                                <div className="flex items-center gap-2 rounded-xl border border-white/6 bg-white/[0.03] px-3 py-3">
                                    <WifiOff size={12} className="text-foreground/30" />
                                    <span className="text-xs text-foreground/40">No peers connected</span>
                                </div>
                            ) : (
                                peerList.map((peer) => (
                                    <div
                                        key={peer.deviceId}
                                        className="rounded-xl border border-white/6 bg-white/[0.03] px-3 py-3"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-mesh-info">
                                                {peer.displayName || peer.deviceId.slice(0, 12)}
                                            </span>
                                            <span className="h-2 w-2 rounded-full bg-mesh-active shadow-[0_0_8px_rgba(90,216,127,0.6)]" />
                                        </div>
                                        {peer.capabilities.length > 0 && (
                                            <p className="mt-1.5 font-mono text-[9px] text-foreground/30">
                                                {peer.capabilities.slice(0, 3).join(" · ")}
                                            </p>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Trust Rules */}
                    <div className="glass-panel p-5">
                        <div className="flex items-center justify-between gap-3">
                            <p className="section-label">Trust Rules</p>
                            <Shield className="h-4 w-4 text-mesh-active/60" />
                        </div>
                        <div className="mt-3 space-y-2">
                            <div className="rounded-xl border border-mesh-active/15 bg-mesh-active/6 px-3 py-2.5 text-[11px] font-medium text-mesh-active">
                                Identity signatures verified
                            </div>
                            <div className="rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2.5">
                                <p className="text-[11px] leading-5 text-foreground/50">
                                    L2/L3 actuation requires human approval
                                </p>
                            </div>
                            <div className="rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2.5">
                                <p className="text-[11px] leading-5 text-foreground/50">
                                    LLM alone never triggers physical action
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
