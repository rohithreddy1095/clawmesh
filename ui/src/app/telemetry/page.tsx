"use client";

import { useMemo } from "react";
import {
    Activity,
    Bot,
    BrainCircuit,
    Clock3,
    HeartPulse,
    Network,
    Radio,
    ShieldCheck,
    Siren,
    Workflow,
} from "lucide-react";
import { useMesh } from "@/lib/useMesh";
import { useMeshStore } from "@/lib/store";
import {
    buildRuntimeTimeline,
    buildSystemEventTimeline,
    derivePlannerRuntimeSummary,
    describePlannerSurface,
    formatRelativeTime,
} from "@/lib/runtime-telemetry";

function formatUptime(uptimeMs?: number): string {
    if (!uptimeMs || uptimeMs < 1000) return "just started";
    const seconds = Math.floor(uptimeMs / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
}

export default function TelemetryPage() {
    const { isConnected } = useMesh();
    const { runtimeHealth, runtimeStatus, runtimeEvents, frames } = useMeshStore();

    const plannerSummary = useMemo(
        () => derivePlannerRuntimeSummary(frames),
        [frames],
    );
    const timeline = useMemo(
        () => buildRuntimeTimeline(frames, Date.now(), 14),
        [frames],
    );
    const refreshSafeTimeline = useMemo(
        () => (timeline.length > 0 ? timeline : buildSystemEventTimeline(runtimeEvents, Date.now(), 14)),
        [timeline, runtimeEvents],
    );
    const plannerSurface = useMemo(
        () => describePlannerSurface(runtimeHealth, runtimeStatus),
        [runtimeHealth, runtimeStatus],
    );

    const latestHeartbeat = runtimeHealth?.timestamp
        ? formatRelativeTime(Date.now() - new Date(runtimeHealth.timestamp).getTime())
        : "awaiting heartbeat";
    const pendingProposals = runtimeStatus?.pendingProposals ?? [];
    const peerDetails = runtimeHealth?.peers.details ?? [];

    const cards = [
        {
            label: "Mesh Link",
            value: isConnected ? "Connected" : "Offline",
            detail: latestHeartbeat,
            icon: Radio,
            tone: isConnected ? "text-mesh-active" : "text-mesh-alert",
        },
        {
            label: "Planner State",
            value: plannerSummary.stageLabel,
            detail: plannerSummary.lastUpdatedLabel,
            icon: BrainCircuit,
            tone: plannerSummary.stage === "error"
                ? "text-mesh-alert"
                : plannerSummary.stage === "thinking"
                    ? "text-claw-accent"
                    : plannerSummary.stage === "queued"
                        ? "text-foreground/70"
                        : "text-white",
        },
        {
            label: "Connected Peers",
            value: String(runtimeStatus?.connectedPeers ?? runtimeHealth?.peers.connected ?? 0),
            detail: `${runtimeHealth?.worldModel.entries ?? 0} world entries`,
            icon: Network,
            tone: "text-white",
        },
        {
            label: "Pending Proposals",
            value: String(pendingProposals.length),
            detail: runtimeHealth?.plannerMode ?? "planner disabled",
            icon: Workflow,
            tone: pendingProposals.length > 0 ? "text-claw-accent" : "text-mesh-active",
        },
    ];

    return (
        <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-6">
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_360px]">
                <div className="glass-panel relative overflow-hidden p-6 sm:p-8">
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_84%_16%,rgba(255,120,68,0.12),transparent_22%),radial-gradient(circle_at_18%_28%,rgba(69,176,203,0.12),transparent_24%)]"
                    />
                    <div className="relative">
                        <p className="section-label">Live Runtime Ops</p>
                        <h1 className="mt-3 flex items-center gap-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                            <Activity className="text-claw-accent" size={38} />
                            Planner Heartbeat
                        </h1>
                        <p className="mt-4 max-w-3xl text-sm leading-7 text-foreground/65 sm:text-base">
                            This surface reflects real backend state from <code>mesh.health</code>, <code>mesh.status</code>,
                            and live context frames. It shows what the planner is doing now, what was processed recently,
                            and whether the field node is healthy.
                        </p>

                        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            {cards.map((card) => {
                                const Icon = card.icon;
                                return (
                                    <div key={card.label} className="metric-card">
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="section-label">{card.label}</p>
                                            <Icon className={card.tone} size={16} />
                                        </div>
                                        <p className={`mt-2 text-2xl font-semibold tracking-tight ${card.tone}`}>
                                            {card.value}
                                        </p>
                                        <p className="mt-2 text-xs leading-5 text-foreground/55">{card.detail}</p>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="glass-panel p-6">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="section-label">Planner Surface</p>
                            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Current Context</h2>
                        </div>
                        <div className="rounded-2xl border border-claw-accent/20 bg-claw-accent/10 p-2 text-claw-accent">
                            <Clock3 className="h-5 w-5" />
                        </div>
                    </div>

                    <div className="mt-5 space-y-3">
                        {plannerSurface.map((row) => (
                            <div key={row.label} className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                                <p className="section-label">{row.label}</p>
                                <p className="mt-2 text-sm font-medium break-all text-white">{row.value}</p>
                            </div>
                        ))}
                        <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                            <p className="section-label">Latest operator intent</p>
                            <p className="mt-2 text-sm leading-6 text-foreground/70">
                                {plannerSummary.lastIntent ?? "No operator turn observed in this browser session yet."}
                            </p>
                        </div>
                        <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                            <p className="section-label">Latest planner output</p>
                            <p className="mt-2 text-sm leading-6 text-foreground/70 whitespace-pre-wrap">
                                {plannerSummary.lastAgentMessage ?? "No recent planner reasoning/output captured yet."}
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            <section className="grid flex-1 gap-6 xl:grid-cols-[minmax(0,1.45fr)_360px]">
                <div className="glass-panel flex min-h-[620px] flex-col overflow-hidden">
                    <div className="flex flex-col gap-4 border-b border-white/6 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="section-label">End-to-End Pipeline</p>
                            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Recent Runtime Activity</h2>
                        </div>
                        <div className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/55">
                            live frames
                        </div>
                    </div>

                    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-6">
                        {refreshSafeTimeline.length === 0 ? (
                            <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-5 text-sm text-foreground/50">
                                Waiting for real runtime frames… refresh-safe telemetry appears here once the backend emits frames.
                            </div>
                        ) : (
                            refreshSafeTimeline.map((entry) => (
                                <div key={entry.id} className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className={`font-mono text-[11px] uppercase tracking-[0.22em] ${entry.tone}`}>
                                            {entry.title}
                                        </span>
                                        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/35">
                                            {entry.timeLabel}
                                        </span>
                                    </div>
                                    <p className="mt-2 text-sm leading-6 text-foreground/70 whitespace-pre-wrap">
                                        {entry.detail}
                                    </p>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="flex flex-col gap-6">
                    <div className="glass-panel p-6">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="section-label">Peer Heartbeat</p>
                                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Nodes</h2>
                            </div>
                            <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-2 text-foreground/60">
                                <HeartPulse className="h-5 w-5" />
                            </div>
                        </div>
                        <div className="mt-5 space-y-3">
                            <div className="rounded-2xl border border-mesh-active/20 bg-mesh-active/8 p-4">
                                <div className="flex items-center gap-2 text-mesh-active">
                                    <ShieldCheck className="h-4 w-4" />
                                    <span className="text-sm font-medium">
                                        Backend heartbeat {latestHeartbeat}; UI socket {isConnected ? "connected" : "offline"}.
                                    </span>
                                </div>
                            </div>
                            {peerDetails.length === 0 ? (
                                <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4 text-sm text-foreground/50">
                                    No peer heartbeat visible yet.
                                </div>
                            ) : (
                                peerDetails.map((peer) => (
                                    <div key={`${peer.deviceId}-${peer.connectedMs}`} className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-mesh-info">
                                                {peer.displayName ?? peer.deviceId}
                                            </span>
                                            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/35">
                                                {formatRelativeTime(peer.connectedMs)}
                                            </span>
                                        </div>
                                        <p className="mt-2 text-sm text-foreground/65">
                                            role={peer.role ?? "node"} · {peer.transportLabel ?? "transport-unknown"}
                                        </p>
                                        {peer.capabilities.length > 0 && (
                                            <p className="mt-2 font-mono text-[10px] leading-5 text-foreground/35 break-all">
                                                {peer.capabilities.join(" · ")}
                                            </p>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="glass-panel p-6">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="section-label">Approval Lane</p>
                                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Pending Proposals</h2>
                            </div>
                            <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-2 text-foreground/60">
                                <Siren className="h-5 w-5" />
                            </div>
                        </div>
                        <div className="mt-5 space-y-3">
                            {pendingProposals.length === 0 ? (
                                <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4 text-sm text-foreground/50">
                                    No pending proposals.
                                </div>
                            ) : (
                                pendingProposals.map((proposal) => (
                                    <div key={proposal.taskId} className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-claw-accent">
                                                {proposal.taskId}
                                            </span>
                                            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/35">
                                                {proposal.approvalLevel}
                                            </span>
                                        </div>
                                        <p className="mt-2 text-sm leading-6 text-foreground/70">{proposal.summary}</p>
                                        <p className="mt-2 text-xs text-foreground/45">
                                            {proposal.status}{proposal.plannerOwner ? ` · owner ${proposal.plannerOwner}` : ""}
                                        </p>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="glass-panel p-6">
                        <div className="flex items-center gap-3">
                            <div className="grid h-11 w-11 place-items-center rounded-2xl border border-claw-accent/20 bg-claw-accent/10 text-claw-accent">
                                <Bot className="h-5 w-5" />
                            </div>
                            <div>
                                <p className="section-label">Node Snapshot</p>
                                <h2 className="mt-1 text-xl font-semibold tracking-tight text-white">Backend Truth</h2>
                            </div>
                        </div>
                        <div className="mt-5 grid gap-3">
                            <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                                <p className="section-label">Node</p>
                                <p className="mt-2 text-sm text-white break-all">
                                    {runtimeHealth?.displayName ?? runtimeHealth?.nodeId ?? runtimeStatus?.localDeviceId ?? "unknown"}
                                </p>
                            </div>
                            <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                                <p className="section-label">Uptime</p>
                                <p className="mt-2 text-sm text-white">{formatUptime(runtimeHealth?.uptimeMs)}</p>
                            </div>
                            <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                                <p className="section-label">Memory</p>
                                <p className="mt-2 text-sm text-white">
                                    {runtimeHealth?.memoryUsageMB ? `${runtimeHealth.memoryUsageMB} MB` : "unknown"}
                                </p>
                            </div>
                            <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                                <p className="section-label">World Model</p>
                                <p className="mt-2 text-sm text-white">
                                    {runtimeHealth?.worldModel.entries ?? 0} entries · {runtimeHealth?.worldModel.frameLogSize ?? 0} frames
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
