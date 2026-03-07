"use client";

import dynamic from "next/dynamic";
import { Map as MapIcon, Droplets, Eye, Layers, Pencil, TreePine } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFarmTwinStore } from "@/lib/farm-twin-store";
import { InfoPanel } from "@/components/farm3d/InfoPanel";
import spatialDataRaw from "@/data/farm-spatial.json";
import type { FarmSpatialData, ViewMode } from "@/lib/farm-spatial-types";
import { useEffect } from "react";

// Dynamic import for the 3D scene (no SSR — Three.js needs browser)
const FarmScene = dynamic(
  () => import("@/components/farm3d/FarmScene").then((m) => m.FarmScene),
  { ssr: false, loading: () => <SceneLoader /> }
);

function SceneLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-claw-accent border-t-transparent" />
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/50">
          Loading 3D farm twin...
        </p>
      </div>
    </div>
  );
}

const VIEW_MODES: { mode: ViewMode; icon: typeof Eye; label: string; detail: string }[] = [
  { mode: "operations", icon: Eye, label: "Operations", detail: "Live monitoring" },
  { mode: "water", icon: Droplets, label: "Water", detail: "Flow topology" },
  { mode: "layers", icon: Layers, label: "Layers", detail: "Forest bands" },
  { mode: "design", icon: Pencil, label: "Design", detail: "Edit layout" },
];

export default function Twin3DPage() {
  const {
    spatialData,
    setSpatialData,
    viewMode,
    setViewMode,
    layerFilter,
    setLayerFilter,
  } = useFarmTwinStore();

  // Load spatial data on mount
  useEffect(() => {
    setSpatialData(spatialDataRaw as unknown as FarmSpatialData);
  }, [setSpatialData]);

  const data = spatialData;

  // Stats
  const zoneCount = data?.zones.length ?? 0;
  const sensorCount = data?.sensors.length ?? 0;
  const lineCount = data?.water_lines.length ?? 0;
  const cropCount = data?.crop_clusters.length ?? 0;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-4">
      {/* Header */}
      <section className="glass-panel relative overflow-hidden p-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_18%,rgba(34,197,94,0.12),transparent_24%),radial-gradient(circle_at_18%_24%,rgba(59,130,246,0.1),transparent_24%)]"
        />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="section-label">Spatial Intelligence</p>
            <h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              <TreePine className="text-mesh-active" size={32} />
              Bhoomi 3D Twin
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/60">
              Navigate the farm in three dimensions. Zones, water infrastructure, crop layers,
              and sensor placement — all in one spatial view.
              <span className="ml-1 rounded border border-mesh-warn/30 bg-mesh-warn/10 px-1.5 py-0.5 font-mono text-[10px] text-mesh-warn">
                placeholder data — pending field survey
              </span>
            </p>
          </div>

          {/* Quick stats */}
          <div className="flex flex-wrap gap-3">
            <Stat label="Zones" value={zoneCount} />
            <Stat label="Sensors" value={sensorCount} />
            <Stat label="Lines" value={lineCount} />
            <Stat label="Crops" value={cropCount} />
          </div>
        </div>
      </section>

      {/* Main content: 3D scene + controls */}
      <section className="grid flex-1 gap-4 xl:grid-cols-[1fr_260px]">
        {/* 3D Viewport */}
        <div className="glass-panel relative flex min-h-[600px] flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 border-b border-white/6 px-4 py-3">
            <div className="flex items-center gap-2">
              <MapIcon size={16} className="text-claw-accent" />
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/50">
                10 acre · farm-local meters
              </span>
            </div>
            <div className="flex gap-1">
              {VIEW_MODES.map((vm) => {
                const Icon = vm.icon;
                return (
                  <button
                    key={vm.mode}
                    onClick={() => setViewMode(vm.mode)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-all",
                      viewMode === vm.mode
                        ? "border-claw-accent/30 bg-claw-accent/12 text-claw-accent"
                        : "border-white/6 bg-white/[0.03] text-foreground/50 hover:text-foreground/80"
                    )}
                  >
                    <Icon size={12} />
                    {vm.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Canvas area */}
          <div className="relative flex-1">
            {data ? <FarmScene data={data} /> : <SceneLoader />}
            {data && <InfoPanel spatialData={data} />}
          </div>
        </div>

        {/* Side controls */}
        <div className="flex flex-col gap-4">
          {/* Layer toggles */}
          <div className="glass-panel p-4">
            <p className="section-label">Layer Visibility</p>
            <h3 className="mt-1 text-lg font-semibold text-white">Forest Bands</h3>
            <div className="mt-3 space-y-2">
              {(["canopy", "subcanopy", "shrub", "ground"] as const).map((layer) => {
                const heights: Record<string, string> = {
                  canopy: "8–15m",
                  subcanopy: "4–8m",
                  shrub: "1–3m",
                  ground: "0–1m",
                };
                const icons: Record<string, string> = {
                  canopy: "🌳",
                  subcanopy: "🌿",
                  shrub: "🌱",
                  ground: "🍃",
                };
                return (
                  <label
                    key={layer}
                    className="flex cursor-pointer items-center justify-between rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2.5 transition-colors hover:bg-white/[0.06]"
                  >
                    <div className="flex items-center gap-2">
                      <span>{icons[layer]}</span>
                      <div>
                        <p className="text-sm font-medium capitalize text-white">{layer}</p>
                        <p className="font-mono text-[10px] text-foreground/40">{heights[layer]}</p>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={layerFilter[layer]}
                      onChange={(e) => setLayerFilter({ [layer]: e.target.checked })}
                      className="h-4 w-4 accent-mesh-active"
                    />
                  </label>
                );
              })}
            </div>
          </div>

          {/* Farm info */}
          <div className="glass-panel p-4">
            <p className="section-label">Farm Profile</p>
            <h3 className="mt-1 text-lg font-semibold text-white">Bhoomi Natural</h3>
            <div className="mt-3 space-y-2 text-sm text-foreground/60">
              <p>📍 Shamli, Uttar Pradesh</p>
              <p>📐 ~10 acres (~200m × 200m)</p>
              <p>🌳 Multilayer food forest</p>
              <p>🧪 No-till, chemical-free</p>
            </div>
            <div className="mt-3 rounded-xl border border-mesh-warn/20 bg-mesh-warn/8 p-3">
              <p className="text-[10px] uppercase tracking-wider text-mesh-warn">Status</p>
              <p className="mt-1 text-sm text-foreground/70">
                Placeholder positions. Field survey needed to replace with measured coordinates.
              </p>
            </div>
          </div>

          {/* Navigation hints */}
          <div className="glass-panel p-4">
            <p className="section-label">Controls</p>
            <div className="mt-2 space-y-1.5 text-sm text-foreground/50">
              <p>🖱️ Left-drag: Rotate</p>
              <p>🖱️ Right-drag: Pan</p>
              <p>⚙️ Scroll: Zoom</p>
              <p>👆 Click: Inspect object</p>
            </div>
          </div>

          {/* Vision statement */}
          <div className="glass-panel p-4">
            <p className="section-label">Vision</p>
            <p className="mt-2 text-xs leading-5 text-foreground/50">
              This 3D twin evolves as we survey the farm, analyze videos with Gemini vision,
              and deploy real sensors. The goal: a living spatial model where you design
              irrigation before buying pipes, place sensors before drilling holes, and
              operate the food forest from any device.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/40">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-white">{String(value).padStart(2, "0")}</p>
    </div>
  );
}
