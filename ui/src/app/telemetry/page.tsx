"use client";

import { Activity, Clock3, Network, Radar, ShieldCheck, Waves } from "lucide-react";

const telemetryMetrics = [
    {
        label: "Active Peers",
        value: "04",
        detail: "Stable responders across the current mesh slice.",
        tone: "text-white",
    },
    {
        label: "Envelopes / Min",
        value: "142",
        detail: "Signed chatter averaged across the last hour.",
        tone: "text-claw-accent",
    },
    {
        label: "Dropped Packets",
        value: "0",
        detail: "No packet loss detected on the current transport path.",
        tone: "text-mesh-active",
    },
];

const discoveryEvents = [
    {
        node: "mac-planner",
        status: "Heartbeat renewed and peer set rebroadcast.",
        time: "Just now",
        accent: "text-claw-accent",
    },
    {
        node: "jetson-field-01",
        status: "Republished mDNS record after context sync.",
        time: "24s ago",
        accent: "text-mesh-info",
    },
    {
        node: "field-node-weather-01",
        status: "Observation stream stayed inside expected jitter budget.",
        time: "1m ago",
        accent: "text-mesh-active",
    },
];

const healthRows = [
    { label: "Discovery", value: "Nominal" },
    { label: "Trust Checks", value: "Passing" },
    { label: "Peer Churn", value: "Low" },
];

export default function TelemetryPage() {
    return (
        <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-6">
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_360px]">
                <div className="glass-panel relative overflow-hidden p-6 sm:p-8">
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_84%_16%,rgba(255,120,68,0.12),transparent_22%),radial-gradient(circle_at_18%_28%,rgba(69,176,203,0.14),transparent_24%)]"
                    />
                    <div className="relative">
                        <p className="section-label">Telemetry Stream</p>
                        <h1 className="mt-3 flex items-center gap-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                            <Activity className="text-claw-accent" size={38} />
                            Telemetry & Discovery
                        </h1>
                        <p className="mt-4 max-w-2xl text-sm leading-7 text-foreground/65 sm:text-base">
                            Track Bonjour visibility, envelope throughput, and transport health across the active mesh.
                        </p>

                        <div className="mt-6 grid gap-3 sm:grid-cols-3">
                            {telemetryMetrics.map((metric) => (
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
                            <p className="section-label">Capture Window</p>
                            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Live Window</h2>
                        </div>
                        <div className="rounded-2xl border border-claw-accent/20 bg-claw-accent/10 p-2 text-claw-accent">
                            <Clock3 className="h-5 w-5" />
                        </div>
                    </div>

                    <div className="mt-5 space-y-3">
                        <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                            <p className="section-label">Scope</p>
                            <p className="mt-2 text-sm font-medium text-white">Last 60 minutes</p>
                            <p className="mt-1 text-sm leading-6 text-foreground/60">
                                Rolling view over `_clawmesh._tcp` discovery and delivery.
                            </p>
                        </div>
                        <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                            <p className="section-label">Sample Rate</p>
                            <p className="mt-2 text-sm font-medium text-white">5 second buckets</p>
                            <p className="mt-1 text-sm leading-6 text-foreground/60">
                                Enough resolution to expose burst traffic and reconnect churn.
                            </p>
                        </div>
                        <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                            <p className="section-label">Retention</p>
                            <p className="mt-2 text-sm font-medium text-white">Ephemeral UI cache</p>
                            <p className="mt-1 text-sm leading-6 text-foreground/60">
                                Recent transport signals stay local to the operator console.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            <section className="grid flex-1 gap-6 xl:grid-cols-[minmax(0,1.45fr)_360px]">
                <div className="glass-panel flex min-h-[620px] flex-col overflow-hidden">
                    <div className="flex flex-col gap-4 border-b border-white/6 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="section-label">Network Throughput</p>
                            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Traffic Pattern</h2>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <div className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/55">
                                1h trend
                            </div>
                            <div className="rounded-full border border-mesh-active/20 bg-mesh-active/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-mesh-active">
                                Stable transport
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-1 flex-col px-6 py-6">
                        <div className="relative flex-1 overflow-hidden rounded-[1.75rem] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-5">
                            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:36px_36px]" />
                            <div className="absolute inset-x-5 top-5 flex items-center gap-4">
                                <div className="flex items-center gap-2 text-xs text-foreground/55">
                                    <span className="h-2.5 w-2.5 rounded-full bg-claw-accent" />
                                    Signed envelopes
                                </div>
                                <div className="flex items-center gap-2 text-xs text-foreground/55">
                                    <span className="h-2.5 w-2.5 rounded-full bg-mesh-active" />
                                    Heartbeats
                                </div>
                                <div className="flex items-center gap-2 text-xs text-foreground/55">
                                    <span className="h-2.5 w-2.5 rounded-full bg-mesh-info" />
                                    Discovery beacons
                                </div>
                            </div>
                            <svg
                                className="absolute inset-0 h-full w-full"
                                preserveAspectRatio="none"
                                viewBox="0 0 100 100"
                            >
                                <path
                                    stroke="rgba(255,120,68,0.95)"
                                    strokeWidth="0.7"
                                    fill="none"
                                    d="M0 78 C 10 68, 16 42, 28 48 S 45 70, 55 54 S 70 22, 84 36 S 94 48, 100 26"
                                />
                                <path
                                    stroke="rgba(90,216,127,0.8)"
                                    strokeWidth="0.7"
                                    fill="none"
                                    d="M0 86 C 12 80, 18 68, 28 74 S 42 84, 55 76 S 72 58, 84 64 S 95 72, 100 58"
                                />
                                <path
                                    stroke="rgba(69,176,203,0.75)"
                                    strokeWidth="0.7"
                                    fill="none"
                                    d="M0 90 C 8 82, 14 74, 25 78 S 45 90, 55 70 S 72 66, 86 72 S 95 80, 100 68"
                                />
                            </svg>
                        </div>

                        <div className="mt-4 flex justify-between font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/40">
                            <span>-60m</span>
                            <span>-30m</span>
                            <span>Now</span>
                        </div>

                        <div className="mt-6 grid gap-3 sm:grid-cols-3">
                            <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                                <p className="section-label">Burst Peak</p>
                                <p className="mt-2 text-xl font-semibold tracking-tight text-white">186 / min</p>
                                <p className="mt-1 text-xs leading-5 text-foreground/55">
                                    Highest signed envelope burst during sync.
                                </p>
                            </div>
                            <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                                <p className="section-label">Median RTT</p>
                                <p className="mt-2 text-xl font-semibold tracking-tight text-claw-accent">92ms</p>
                                <p className="mt-1 text-xs leading-5 text-foreground/55">
                                    Cross-mesh response time across active peers.
                                </p>
                            </div>
                            <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                                <p className="section-label">Reconnects</p>
                                <p className="mt-2 text-xl font-semibold tracking-tight text-mesh-active">0</p>
                                <p className="mt-1 text-xs leading-5 text-foreground/55">
                                    No peer reconnects during the sample window.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-6">
                    <div className="glass-panel p-6">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="section-label">Discovery Log</p>
                                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Recent Signals</h2>
                            </div>
                            <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-2 text-foreground/55">
                                <Waves className="h-5 w-5" />
                            </div>
                        </div>
                        <div className="mt-5 space-y-3">
                            {discoveryEvents.map((event) => (
                                <div key={`${event.node}-${event.time}`} className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className={`font-mono text-[11px] uppercase tracking-[0.22em] ${event.accent}`}>
                                            {event.node}
                                        </span>
                                        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/35">
                                            {event.time}
                                        </span>
                                    </div>
                                    <p className="mt-2 text-sm leading-6 text-foreground/65">{event.status}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="glass-panel p-6">
                        <p className="section-label">Integrity</p>
                        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Health Snapshot</h2>
                        <div className="mt-5 space-y-3">
                            <div className="rounded-2xl border border-mesh-active/20 bg-mesh-active/8 p-4">
                                <div className="flex items-center gap-2 text-mesh-active">
                                    <ShieldCheck className="h-4 w-4" />
                                    <span className="text-sm font-medium">Signed transport checks are passing.</span>
                                </div>
                            </div>
                            {healthRows.map((row) => (
                                <div key={row.label} className="flex items-center justify-between rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-4">
                                    <span className="text-sm text-foreground/60">{row.label}</span>
                                    <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-white">
                                        {row.value}
                                    </span>
                                </div>
                            ))}
                            <div className="rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-4">
                                <div className="flex items-center gap-2 text-sm text-foreground/65">
                                    <Network className="h-4 w-4 text-mesh-info" />
                                    Peer visibility remains consistent across all current endpoints.
                                </div>
                            </div>
                            <div className="rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-4">
                                <div className="flex items-center gap-2 text-sm text-foreground/65">
                                    <Radar className="h-4 w-4 text-claw-accent" />
                                    No anomalous discovery beacons detected in the current window.
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
