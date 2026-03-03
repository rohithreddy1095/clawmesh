"use client";

import {
    CheckCircle2,
    ChevronRight,
    Clock3,
    Radar,
    Send,
    ShieldAlert,
    TerminalSquare,
    XCircle,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useMesh } from "@/lib/useMesh";

const commandMetrics = [
    {
        label: "Dispatch Mode",
        value: "Operator",
        detail: "Human keeps the final say on risky envelopes.",
        tone: "text-white",
    },
    {
        label: "Approval Queue",
        value: "01",
        detail: "One high-risk task is waiting for verification.",
        tone: "text-claw-accent",
    },
    {
        label: "Intent Latency",
        value: "180ms",
        detail: "Median round-trip from operator to planner.",
        tone: "text-mesh-active",
    },
];

const quickIntents = [
    "Ask Jetson to draft a moisture-aware irrigation plan.",
    "Request the latest tank reserve snapshot from water node 01.",
    "Summarize the last 15 minutes of field telemetry anomalies.",
];

const targetNodes = [
    {
        id: "mac-planner",
        role: "Planning gateway",
        state: "Ready",
        tone: "text-claw-accent",
    },
    {
        id: "jetson-field-01",
        role: "Field orchestration brain",
        state: "Awaiting review",
        tone: "text-mesh-info",
    },
    {
        id: "field-node-water-01",
        role: "Pump and valve control",
        state: "Ready",
        tone: "text-mesh-active",
    },
];

const executionRules = [
    "Natural language intent is parsed into a signed mesh envelope.",
    "Actuation over the L3 trust tier remains paused until approved.",
    "Every execution result is reflected back into the planner context.",
];

export default function CommandPage() {
    const { isConnected, sendCommand } = useMesh();
    const [command, setCommand] = useState("");

    // Store sent commands
    const [sentCommands, setSentCommands] = useState<{ id: string, text: string, time: string }[]>([]);

    // Local state to simulate resolving the mocked L3 execution request
    const [mockTaskStatus, setMockTaskStatus] = useState<"pending" | "approved" | "rejected">("pending");

    const handleApprove = () => {
        setMockTaskStatus("approved");
        // In a real app we'd dispatch: sendCommand("jetson-field-01", "actuator:pump:P1", "flush")
    };

    const handleReject = () => {
        setMockTaskStatus("rejected");
    };

    const handleSubmitCommand = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!command.trim()) return;

        const newCmd = {
            id: Math.random().toString(36).substring(7),
            text: command.trim(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        setSentCommands(prev => [...prev, newCmd]);

        // Dispatch to backend simulator
        if (isConnected) {
            sendCommand({
                to: "agent:pi",
                targetRef: "agent:pi",
                operation: "intent:parse",
                operationParams: { text: command.trim() }
            });
        }

        setCommand("");
    };

    return (
        <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-6">
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_360px]">
                <div className="glass-panel relative overflow-hidden p-6 sm:p-8">
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,120,68,0.14),transparent_24%),radial-gradient(circle_at_20%_28%,rgba(69,176,203,0.12),transparent_24%)]"
                    />
                    <div className="relative">
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                            <div>
                                <p className="section-label">Operator Queue</p>
                                <h1 className="mt-3 flex items-center gap-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                                    <TerminalSquare className="text-claw-accent" size={38} />
                                    Command Center
                                </h1>
                                <p className="mt-4 max-w-2xl text-sm leading-7 text-foreground/65 sm:text-base">
                                    Dispatch intent, inspect trust gates, and keep high-risk execution visible before it
                                    reaches the field.
                                </p>
                            </div>

                            <div className="inline-flex items-center gap-3 self-start rounded-full border border-white/8 bg-white/[0.04] px-4 py-2">
                                <span className="relative flex h-3 w-3">
                                    <span
                                        className={cn(
                                            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                                            isConnected ? "bg-mesh-active" : "bg-mesh-alert"
                                        )}
                                    />
                                    <span
                                        className={cn(
                                            "relative inline-flex h-3 w-3 rounded-full",
                                            isConnected ? "bg-mesh-active" : "bg-mesh-alert"
                                        )}
                                    />
                                </span>
                                <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground/60">
                                    {isConnected ? "Mesh Connected" : "Offline"}
                                </span>
                            </div>
                        </div>

                        <div className="mt-6 grid gap-3 sm:grid-cols-3">
                            {commandMetrics.map((metric) => (
                                <div key={metric.label} className="metric-card">
                                    <p className="section-label">{metric.label}</p>
                                    <p className={`mt-2 text-2xl font-semibold tracking-tight ${metric.tone}`}>
                                        {metric.value}
                                    </p>
                                    <p className="mt-2 text-xs leading-5 text-foreground/55">{metric.detail}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="glass-panel p-6">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="section-label">Fast Start</p>
                            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Quick Intents</h2>
                        </div>
                        <div className="rounded-2xl border border-claw-accent/20 bg-claw-accent/10 p-2 text-claw-accent">
                            <Radar className="h-5 w-5" />
                        </div>
                    </div>

                    <div className="mt-5 space-y-3">
                        {quickIntents.map((intent) => (
                            <button
                                key={intent}
                                type="button"
                                onClick={() => setCommand(intent)}
                                className="flex w-full items-start justify-between gap-3 rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-4 text-left transition-colors hover:border-white/10 hover:bg-white/[0.05]"
                            >
                                <span className="text-sm leading-6 text-foreground/70">{intent}</span>
                                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-foreground/35" />
                            </button>
                        ))}
                    </div>
                </div>
            </section>

            <section className="grid flex-1 gap-6 xl:grid-cols-[minmax(0,1.45fr)_360px]">
                <div className="flex min-h-[620px] flex-col gap-6">
                    <div className="glass-panel flex flex-1 flex-col overflow-hidden">
                        <div className="flex flex-col gap-4 border-b border-white/6 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="section-label">Execution Feed</p>
                                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Recent Actions</h2>
                            </div>
                            <div className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/55">
                                12 events in the last hour
                            </div>
                        </div>

                        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
                            <div className="rounded-2xl border border-white/6 bg-white/[0.035] p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <CheckCircle2 className="text-mesh-active" size={18} />
                                            <span className="text-sm font-semibold tracking-tight text-white">
                                                Weather Node Sync
                                            </span>
                                        </div>
                                        <p className="mt-2 text-sm leading-6 text-foreground/65">
                                            Completed observation sweep and pushed the latest environment state into the
                                            planner context.
                                        </p>
                                    </div>
                                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/35">
                                        10:45 AM
                                    </span>
                                </div>
                            </div>

                            {mockTaskStatus === "pending" ? (
                                <div className="rounded-2xl border border-mesh-alert/20 bg-mesh-alert/10 p-5 shadow-[0_0_24px_rgba(255,93,77,0.12)]">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-mesh-alert">
                                                <ShieldAlert size={18} />
                                                <span className="text-sm font-semibold uppercase tracking-[0.18em]">
                                                    Human Verification Required
                                                </span>
                                            </div>
                                            <p className="mt-3 text-sm leading-6 text-foreground/80">
                                                Jetson Nano proposed an emergency 30-minute irrigation flush for Zone 1
                                                due to a sharp moisture drop.
                                            </p>
                                        </div>
                                        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/35">
                                            10:52 AM
                                        </span>
                                    </div>
                                    <div className="mt-4 rounded-2xl border border-white/6 bg-black/25 p-4 font-mono text-xs leading-6 text-mesh-warn">
                                        {">>"} Target: actuator:pump:P1
                                        <br />
                                        {">>"} Duration: 1800s
                                        <br />
                                        {">>"} Requester: jetson-field-01
                                    </div>
                                    <div className="mt-4 flex flex-wrap gap-3">
                                        <button
                                            onClick={handleApprove}
                                            className="rounded-2xl bg-mesh-active px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-mesh-active/80"
                                        >
                                            Approve Execution
                                        </button>
                                        <button
                                            onClick={handleReject}
                                            className="rounded-2xl border border-white/8 bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/[0.12]"
                                        >
                                            Reject
                                        </button>
                                    </div>
                                </div>
                            ) : mockTaskStatus === "approved" ? (
                                <div className="rounded-2xl border border-mesh-active/20 bg-mesh-active/8 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-mesh-active">
                                                <CheckCircle2 size={18} />
                                                <span className="text-sm font-semibold text-white">
                                                    Execution Approved
                                                </span>
                                            </div>
                                            <p className="mt-2 text-sm leading-6 text-foreground/55 line-through">
                                                Jetson Nano proposed an emergency 30-minute irrigation flush for Zone 1.
                                            </p>
                                            <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-mesh-active">
                                                {">>"} Envelope released to jetson-field-01
                                            </div>
                                        </div>
                                        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/35">
                                            Just now
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4 opacity-70">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-foreground/55">
                                                <XCircle size={18} />
                                                <span className="text-sm font-semibold text-white">
                                                    Execution Rejected
                                                </span>
                                            </div>
                                            <p className="mt-2 text-sm leading-6 text-foreground/50 line-through">
                                                Jetson Nano proposed an emergency 30-minute irrigation flush for Zone 1.
                                            </p>
                                            <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/45">
                                                {">>"} Task discarded by operator
                                            </div>
                                        </div>
                                        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/35">
                                            Just now
                                        </span>
                                    </div>
                                </div>
                            )}

                            {sentCommands.map((cmd) => (
                                <div key={cmd.id} className="rounded-2xl border border-claw-accent/14 bg-claw-accent/7 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-claw-accent">
                                                <TerminalSquare size={18} />
                                                <span className="text-sm font-semibold text-white">
                                                    Operator Intent Dispatched
                                                </span>
                                            </div>
                                            <p className="mt-2 font-mono text-sm leading-6 text-foreground/80">
                                                &ldquo;{cmd.text}&rdquo;
                                            </p>
                                            <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-claw-accent">
                                                {">>"} Processing via mac-planner
                                            </div>
                                        </div>
                                        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/35">
                                            {cmd.time}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <form
                        onSubmit={handleSubmitCommand}
                        className="glass-panel border border-white/6 p-5 transition-all focus-within:border-claw-accent/25"
                    >
                        <div className="flex flex-col gap-4">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="section-label">Compose Intent</p>
                                    <p className="mt-2 text-lg font-semibold tracking-tight text-white">
                                        Draft the next operator instruction
                                    </p>
                                </div>
                                <Clock3 className="h-5 w-5 text-foreground/45" />
                            </div>

                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                <div className="flex flex-1 items-center gap-3 rounded-2xl border border-white/6 bg-black/20 px-4 py-3">
                                    <TerminalSquare className="text-claw-accent" size={18} />
                                    <input
                                        type="text"
                                        placeholder="Ask Jetson to propose an irrigation schedule based on current soil data..."
                                        className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
                                        value={command}
                                        onChange={(e) => setCommand(e.target.value)}
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={!command.trim()}
                                    className="inline-flex items-center justify-center rounded-2xl bg-claw-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-claw-accent-bright disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <Send size={18} />
                                </button>
                            </div>
                        </div>
                    </form>
                </div>

                <div className="flex flex-col gap-6">
                    <div className="glass-panel p-6">
                        <p className="section-label">Available Targets</p>
                        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Mesh Endpoints</h2>
                        <div className="mt-5 space-y-3">
                            {targetNodes.map((node) => (
                                <div
                                    key={node.id}
                                    className="rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-4 transition-colors hover:border-white/10 hover:bg-white/[0.05]"
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <span className={`font-mono text-[11px] uppercase tracking-[0.22em] ${node.tone}`}>
                                            {node.id}
                                        </span>
                                        <span className="h-2.5 w-2.5 rounded-full bg-mesh-active shadow-[0_0_12px_rgba(90,216,127,0.7)]" />
                                    </div>
                                    <p className="mt-2 text-sm font-medium text-white">{node.role}</p>
                                    <p className="mt-1 text-xs text-foreground/50">{node.state}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="glass-panel p-6">
                        <p className="section-label">Control Rules</p>
                        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Trust & Gating</h2>
                        <div className="mt-5 space-y-3">
                            <div className="rounded-2xl border border-mesh-active/20 bg-mesh-active/8 px-4 py-4 text-sm font-medium text-mesh-active">
                                Identity signatures valid across active peers.
                            </div>
                            {executionRules.map((rule) => (
                                <div key={rule} className="rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-4">
                                    <p className="text-sm leading-6 text-foreground/65">{rule}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
