"use client";

import { Map as MapIcon, Droplets, ThermometerSun, Leaf, Activity, ShieldCheck, Waves } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMeshStore } from "@/lib/store";
import { useMesh } from "@/lib/useMesh";

const defaultZones = [
    {
        id: "z1",
        name: "Mango Orchard",
        moisture: 42,
        temp: 31,
        active: true,
        coordinates: "min-h-[210px] xl:col-start-1 xl:col-end-4 xl:row-start-1 xl:row-end-4",
    },
    {
        id: "z2",
        name: "Banana Layer",
        moisture: 68,
        temp: 28,
        active: false,
        coordinates: "min-h-[210px] xl:col-start-4 xl:col-end-7 xl:row-start-1 xl:row-end-3",
    },
    {
        id: "z3",
        name: "Nursery / Herbs",
        moisture: 85,
        temp: 26,
        active: true,
        coordinates: "min-h-[210px] xl:col-start-1 xl:col-end-3 xl:row-start-4 xl:row-end-7",
    },
    {
        id: "z4",
        name: "Main Tank",
        moisture: 100,
        temp: null,
        active: true,
        coordinates: "min-h-[210px] xl:col-start-7 xl:col-end-9 xl:row-start-1 xl:row-end-3",
        isTank: true,
    },
];

const twinMetrics = [
    {
        label: "Zones in Sync",
        value: "04",
        detail: "Every logical zone has a fresh observation frame.",
        tone: "text-white",
    },
    {
        label: "Moisture Spread",
        value: "42-85%",
        detail: "Current range across orchard, canopy, and nursery layers.",
        tone: "text-claw-accent",
    },
    {
        label: "Tank Reserve",
        value: "85%",
        detail: "Main tank remains above the intervention threshold.",
        tone: "text-mesh-active",
    },
];

const layerInsights = [
    {
        label: "Canopy Layer",
        value: "Mango / Litchi",
        status: "Healthy",
        tone: "text-mesh-active",
    },
    {
        label: "Shrub Layer",
        value: "Gladiolus",
        status: "Harvesting",
        tone: "text-mesh-warn",
    },
    {
        label: "Ground Layer",
        value: "Herbs / nursery beds",
        status: "Moisture rich",
        tone: "text-mesh-info",
    },
];

const twinSignals = [
    "Observation frames are folded into the world model before rendering.",
    "Recent moisture updates pulse active zones to show fresh field attention.",
    "Water reserve stays visible as a guardrail for automated planning.",
];

export default function DigitalTwinPage() {
    const { getFramesByKind } = useMeshStore();
    const { isConnected } = useMesh();
    const obsFrames = getFramesByKind("observation");
    const latestObservationTimestamp = obsFrames[0]?.timestamp ?? 0;
    const liveZones = defaultZones.map((zone) => {
        const zoneFrames = obsFrames.filter(
            (frame) => frame.data?.zone === zone.id || (frame.data?.zone === "zone-1" && zone.id === "z1")
        );

        const updatedZone = { ...zone };

        for (const frame of zoneFrames) {
            if (frame.data?.metric === "moisture" && typeof frame.data?.value === "number") {
                updatedZone.moisture = frame.data.value;
                updatedZone.active = latestObservationTimestamp - frame.timestamp < 10000;
            }
            if (frame.data?.metric === "temp" && typeof frame.data?.value === "number") {
                updatedZone.temp = frame.data.value;
            }
        }

        return updatedZone;
    });

    return (
        <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-6">
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_360px]">
                <div className="glass-panel relative overflow-hidden p-6 sm:p-8">
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,rgba(255,120,68,0.12),transparent_24%),radial-gradient(circle_at_18%_24%,rgba(90,216,127,0.1),transparent_24%)]"
                    />
                    <div className="relative">
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                            <div>
                                <p className="section-label">Spatial State</p>
                                <h1 className="mt-3 flex items-center gap-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                                    <MapIcon className="text-claw-accent" size={38} />
                                    Bhoomi Digital Twin
                                </h1>
                                <p className="mt-4 max-w-2xl text-sm leading-7 text-foreground/65 sm:text-base">
                                    Logical zones, hydration signals, and water reserve presented as an operator-friendly
                                    world model.
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
                                    {isConnected ? "World Model Synced" : "Offline"}
                                </span>
                            </div>
                        </div>

                        <div className="mt-6 grid gap-3 sm:grid-cols-3">
                            {twinMetrics.map((metric) => (
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
                            <p className="section-label">Twin Rules</p>
                            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Observation Bus</h2>
                        </div>
                        <div className="rounded-2xl border border-claw-accent/20 bg-claw-accent/10 p-2 text-claw-accent">
                            <Waves className="h-5 w-5" />
                        </div>
                    </div>

                    <div className="mt-5 space-y-3">
                        {twinSignals.map((signal) => (
                            <div key={signal} className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                                <p className="text-sm leading-6 text-foreground/65">{signal}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="grid flex-1 gap-6 xl:grid-cols-[minmax(0,1.45fr)_360px]">
                <div className="glass-panel flex min-h-[620px] flex-col overflow-hidden p-6">
                    <div className="flex items-center justify-between gap-3 border-b border-white/6 pb-5">
                        <div>
                            <p className="section-label">Logical Zones</p>
                            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Field Map</h2>
                        </div>
                        <div className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/55">
                            10 acre view
                        </div>
                    </div>

                    <div className="relative mt-6 flex-1 overflow-hidden rounded-[1.75rem] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-4 sm:p-5">
                        <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 opacity-12"
                            style={{
                                backgroundImage: "radial-gradient(var(--color-claw-accent) 1px, transparent 1px)",
                                backgroundSize: "40px 40px",
                            }}
                        />

                        <div className="relative grid h-full auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-8 xl:grid-rows-6">
                            {liveZones.map((zone) => (
                                <div
                                    key={zone.id}
                                    className={cn(
                                        "flex flex-col justify-between rounded-3xl border p-4 transition-all duration-500 backdrop-blur-md",
                                        zone.coordinates,
                                        zone.isTank
                                            ? "border-mesh-info/25 bg-mesh-info/8"
                                            : zone.active
                                              ? "scale-[1.01] border-mesh-active/35 bg-mesh-active/8 shadow-[0_0_24px_rgba(90,216,127,0.08)]"
                                              : "border-white/8 bg-white/[0.03]"
                                    )}
                                >
                                    <div>
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-lg font-semibold tracking-tight text-white">{zone.name}</p>
                                                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/45">
                                                    {zone.id}
                                                </p>
                                            </div>
                                            {zone.active && !zone.isTank && (
                                                <span className="rounded-full border border-mesh-active/20 bg-mesh-active/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-mesh-active">
                                                    Live
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="mt-6 flex flex-wrap gap-3">
                                        {zone.moisture !== null && (
                                            <div className="rounded-2xl border border-white/6 bg-black/20 px-3 py-2">
                                                <div className="flex items-center gap-2 text-mesh-info">
                                                    <Droplets size={15} />
                                                    <span className="font-mono text-sm font-medium text-white">
                                                        {zone.moisture}%
                                                    </span>
                                                </div>
                                                <p className="mt-1 text-[11px] text-foreground/45">Moisture</p>
                                            </div>
                                        )}
                                        {zone.temp !== null && (
                                            <div className="rounded-2xl border border-white/6 bg-black/20 px-3 py-2">
                                                <div className="flex items-center gap-2 text-claw-accent">
                                                    <ThermometerSun size={15} />
                                                    <span className="font-mono text-sm font-medium text-white">
                                                        {zone.temp}°C
                                                    </span>
                                                </div>
                                                <p className="mt-1 text-[11px] text-foreground/45">Temperature</p>
                                            </div>
                                        )}
                                    </div>

                                    {zone.isTank && (
                                        <div className="mt-6">
                                            <p className="section-label">Reserve</p>
                                            <div className="mt-3 h-3 overflow-hidden rounded-full bg-black/30">
                                                <div className="h-full rounded-full bg-mesh-info" style={{ width: "85%" }} />
                                            </div>
                                        </div>
                                    )}

                                    {!zone.isTank && zone.active && (
                                        <div className="mt-6 flex items-center gap-2 text-xs text-mesh-active">
                                            <Activity size={14} className="animate-pulse" />
                                            Fresh observation received inside the current pulse window.
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-6">
                    <div className="glass-panel p-6">
                        <div className="flex items-center gap-3">
                            <div className="grid h-11 w-11 place-items-center rounded-2xl border border-mesh-active/20 bg-mesh-active/10 text-mesh-active">
                                <Leaf className="h-5 w-5" />
                            </div>
                            <div>
                                <p className="section-label">Layer Analysis</p>
                                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">Plant Bands</h2>
                            </div>
                        </div>
                        <div className="mt-5 space-y-3">
                            {layerInsights.map((item) => (
                                <div key={item.label} className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                                    <p className="section-label">{item.label}</p>
                                    <div className="mt-2 flex items-center justify-between gap-3">
                                        <span className="text-sm font-medium text-white">{item.value}</span>
                                        <span className={`font-mono text-[11px] uppercase tracking-[0.2em] ${item.tone}`}>
                                            {item.status}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="glass-panel p-6">
                        <div className="flex items-center gap-3">
                            <div className="grid h-11 w-11 place-items-center rounded-2xl border border-mesh-info/20 bg-mesh-info/10 text-mesh-info">
                                <ShieldCheck className="h-5 w-5" />
                            </div>
                            <div>
                                <p className="section-label">System Guardrails</p>
                                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">Water System</h2>
                            </div>
                        </div>

                        <div className="mt-5 rounded-3xl border border-mesh-info/20 bg-mesh-info/8 p-5">
                            <div className="flex items-end justify-between gap-4">
                                <div>
                                    <p className="section-label">Main Tank Reserve</p>
                                    <p className="mt-2 text-4xl font-semibold tracking-tight text-white">85%</p>
                                    <p className="mt-2 text-sm leading-6 text-foreground/60">
                                        Enough headroom for emergency irrigation without breaching reserve policy.
                                    </p>
                                </div>
                                <div className="relative h-24 w-14 overflow-hidden rounded-2xl border border-mesh-info/25 bg-black/25">
                                    <div className="absolute bottom-0 w-full bg-mesh-info" style={{ height: "85%" }} />
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 space-y-3">
                            <div className="rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-4">
                                <p className="text-sm leading-6 text-foreground/65">
                                    Planning remains inside the safe operating band while reserve stays above 60%.
                                </p>
                            </div>
                            <div className="rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-4">
                                <p className="text-sm leading-6 text-foreground/65">
                                    Any L3 watering action still escalates through the operator gate before actuation.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
