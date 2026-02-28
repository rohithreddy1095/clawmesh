"use client";

import { useEffect, useState } from "react";
import { Map as MapIcon, Droplets, ThermometerSun, Leaf, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMeshStore } from "@/lib/store";
import { useMesh } from "@/lib/useMesh";

const defaultZones = [
    { id: "z1", name: "Mango Orchard", moisture: 42, temp: 31, active: true, coordinates: "col-start-1 col-end-4 row-start-1 row-end-4" },
    { id: "z2", name: "Banana Layer", moisture: 68, temp: 28, active: false, coordinates: "col-start-4 col-end-7 row-start-1 row-end-3" },
    { id: "z3", name: "Nursery / Herbs", moisture: 85, temp: 26, active: true, coordinates: "col-start-1 col-end-3 row-start-4 row-end-7" },
    { id: "z4", name: "Main Tank", moisture: 100, temp: null, active: true, coordinates: "col-start-7 col-end-9 row-start-1 row-end-3", isTank: true },
];

export default function DigitalTwinPage() {
    const { getFramesByKind } = useMeshStore();
    const { isConnected } = useMesh();

    // Compute current live zones from the context gossip
    const [liveZones, setLiveZones] = useState(defaultZones);

    useEffect(() => {
        // Find all observation frames
        const obsFrames = getFramesByKind("observation");

        setLiveZones(currentZones => currentZones.map(zone => {
            // Find the most recent moisture/temp frames for this zone
            const zoneFrames = obsFrames.filter(f => f.data?.zone === zone.id || (f.data?.zone === "zone-1" && zone.id === "z1"));

            let updatedZone = { ...zone };

            // Apply the latest observations to the zone visual layer
            for (const frame of zoneFrames) {
                if (frame.data?.metric === "moisture" && typeof frame.data?.value === "number") {
                    updatedZone.moisture = frame.data.value;
                    // Flash 'active' green style if recent
                    updatedZone.active = (Date.now() - frame.timestamp) < 10000;
                }
                if (frame.data?.metric === "temp" && typeof frame.data?.value === "number") {
                    updatedZone.temp = frame.data.value;
                }
            }

            return updatedZone;
        }));
    }, [getFramesByKind]);

    return (
        <div className="h-full w-full flex flex-col p-8">
            <div className="mb-6 z-10">
                <h1 className="text-4xl font-bold tracking-tight text-white flex items-center gap-3">
                    <MapIcon className="text-claw-accent" size={36} />
                    Bhoomi Digital Twin
                </h1>
                <p className="mt-2 text-foreground/60 font-mono text-sm max-w-xl">
                    Shamli 10-Acre Food Forest. Sensor data overlaid on logical zones.
                </p>
                <div className="mt-4 flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                        <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", isConnected ? "bg-green-400" : "bg-red-400")}></span>
                        <span className={cn("relative inline-flex rounded-full h-3 w-3", isConnected ? "bg-green-500" : "bg-red-500")}></span>
                    </span>
                    <span className="font-mono text-sm text-foreground/60">
                        {isConnected ? "WORLD_MODEL_SYNCED" : "OFFLINE"}
                    </span>
                </div>
            </div>

            <div className="flex-1 grid grid-cols-12 gap-6 relative z-10">
                {/* Spatial Map View */}
                <div className="col-span-8 glass-panel p-6 flex flex-col relative overflow-hidden">
                    <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(var(--color-claw-accent) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

                    <div className="flex-1 grid grid-cols-8 grid-rows-6 gap-4 relative z-10">
                        {liveZones.map(zone => (
                            <div
                                key={zone.id}
                                className={cn(
                                    "rounded-2xl border-2 p-4 transition-all duration-500  cursor-pointer flex flex-col justify-between backdrop-blur-md",
                                    zone.coordinates,
                                    zone.isTank ? "border-blue-500/50 bg-blue-500/10" :
                                        zone.active ? "border-mesh-active/80 bg-mesh-active/10 scale-[1.02]" : "border-mesh-active/30 bg-mesh-active/5"
                                )}
                            >
                                <div>
                                    <div className="font-bold text-lg text-white mb-1 tracking-tight flex items-center justify-between">
                                        {zone.name}
                                        {zone.active && !zone.isTank && <Activity size={16} className="text-mesh-active animate-pulse" />}
                                    </div>
                                    <div className="font-mono text-[10px] text-foreground/50 uppercase tracking-widest">{zone.id}</div>
                                </div>

                                <div className="flex gap-4 mt-4">
                                    {zone.moisture !== null && (
                                        <div className="flex items-center gap-1.5 text-blue-400">
                                            <Droplets size={16} />
                                            <span className="font-mono font-medium">{zone.moisture}%</span>
                                        </div>
                                    )}
                                    {zone.temp !== null && (
                                        <div className="flex items-center gap-1.5 text-orange-400">
                                            <ThermometerSun size={16} />
                                            <span className="font-mono font-medium">{zone.temp}°C</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Info Panel Right */}
                <div className="col-span-4 flex flex-col gap-6">
                    <div className="glass-panel p-6 flex-[2]">
                        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Leaf className="text-mesh-active" /> Layer Analysis
                        </h2>
                        <div className="space-y-4">
                            <div className="bg-black/40 border border-white/5 rounded-lg p-3">
                                <div className="text-xs font-mono text-foreground/50 mb-1">CANOPY LAYER</div>
                                <div className="flex justify-between items-center">
                                    <span>Mango / Litchi</span>
                                    <span className="text-mesh-active text-xs">Healthy</span>
                                </div>
                            </div>
                            <div className="bg-black/40 border border-white/5 rounded-lg p-3">
                                <div className="text-xs font-mono text-foreground/50 mb-1">SHRUB LAYER</div>
                                <div className="flex justify-between items-center">
                                    <span>Gladiolus</span>
                                    <span className="text-mesh-warn text-xs">Harvesting</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="glass-panel p-6 flex-1 bg-blue-500/5 border-blue-500/20">
                        <h2 className="text-lg font-bold text-blue-100 mb-4 tracking-tight">Water System</h2>
                        <div className="flex items-end justify-between">
                            <div>
                                <div className="text-4xl font-mono text-blue-400 font-bold">85%</div>
                                <div className="text-blue-200/60 text-sm mt-1">Main Tank Reserve</div>
                            </div>
                            <div className="h-20 w-12 bg-black/50 rounded-lg overflow-hidden relative border border-blue-500/30">
                                <div className="absolute bottom-0 w-full bg-blue-500/80 transition-all duration-1000" style={{ height: '85%' }} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
