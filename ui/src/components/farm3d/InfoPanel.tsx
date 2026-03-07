"use client";

import { X, Droplets, ThermometerSun, MapPin, Cpu, Waves } from "lucide-react";
import type { FarmSpatialData } from "@/lib/farm-spatial-types";
import { useFarmTwinStore } from "@/lib/farm-twin-store";

interface InfoPanelProps {
  spatialData: FarmSpatialData;
}

export function InfoPanel({ spatialData }: InfoPanelProps) {
  const { selectedId, selectedType, select, zoneLive, assetLive } = useFarmTwinStore();

  if (!selectedId || !selectedType) return null;

  const handleClose = () => select(null, null);

  let content: React.ReactNode = null;

  if (selectedType === "zone") {
    const zone = spatialData.zones.find((z) => z.zone_id === selectedId);
    const live = zoneLive[selectedId];
    if (zone) {
      const area = calculatePolygonArea(zone.polygon);
      content = (
        <>
          <div className="flex items-center gap-2 text-mesh-active">
            <MapPin size={16} />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Zone</span>
          </div>
          <h3 className="mt-2 text-lg font-semibold text-white">{zone.zone_id}</h3>
          <div className="mt-3 space-y-2 text-sm text-foreground/70">
            <p>Area: ~{area.toFixed(0)} m² ({(area / 4047).toFixed(2)} acres)</p>
            {zone.layer_heights && (
              <div>
                <p className="text-foreground/50">Layers:</p>
                {zone.layer_heights.canopy_top && <p className="ml-2">🌳 Canopy: {zone.layer_heights.canopy_top}m</p>}
                {zone.layer_heights.subcanopy_top && <p className="ml-2">🌿 Sub-canopy: {zone.layer_heights.subcanopy_top}m</p>}
                {zone.layer_heights.shrub_top && <p className="ml-2">🌱 Shrub: {zone.layer_heights.shrub_top}m</p>}
                {zone.layer_heights.ground_top && <p className="ml-2">🍃 Ground: {zone.layer_heights.ground_top}m</p>}
              </div>
            )}
            {live && (
              <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <p className="text-[10px] uppercase tracking-wider text-foreground/40">Live Readings</p>
                {live.moisture !== undefined && (
                  <div className="mt-1 flex items-center gap-2">
                    <Droplets size={14} className="text-mesh-info" />
                    <span className="text-white">{live.moisture}% moisture</span>
                  </div>
                )}
                {live.temperature !== undefined && (
                  <div className="mt-1 flex items-center gap-2">
                    <ThermometerSun size={14} className="text-claw-accent" />
                    <span className="text-white">{live.temperature}°C</span>
                  </div>
                )}
              </div>
            )}
          </div>
          {/* Crops in this zone */}
          <div className="mt-3">
            <p className="text-[10px] uppercase tracking-wider text-foreground/40">Crops</p>
            {spatialData.crop_clusters
              .filter((c) => c.zone_id === selectedId)
              .map((c) => (
                <div key={c.cluster_id} className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-white">{c.species}</span>
                  <span className="text-foreground/50">{c.layer} · {c.avg_height_m}m</span>
                </div>
              ))}
          </div>
          {/* Sensors in this zone */}
          <div className="mt-3">
            <p className="text-[10px] uppercase tracking-wider text-foreground/40">Sensors</p>
            {spatialData.sensors
              .filter((s) => s.zone_id === selectedId)
              .map((s) => (
                <div key={s.sensor_id} className="mt-1 flex items-center gap-2 text-sm">
                  <Cpu size={12} className="text-foreground/40" />
                  <span className="text-white">{s.type.replace(/_/g, " ")}</span>
                </div>
              ))}
          </div>
        </>
      );
    }
  }

  if (selectedType === "asset") {
    const asset = spatialData.assets.find((a) => a.asset_id === selectedId);
    const live = assetLive[selectedId];
    if (asset) {
      content = (
        <>
          <div className="flex items-center gap-2 text-mesh-info">
            <Cpu size={16} />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em]">{asset.type}</span>
          </div>
          <h3 className="mt-2 text-lg font-semibold text-white">{asset.asset_id}</h3>
          <div className="mt-3 space-y-2 text-sm text-foreground/70">
            <p>Zone: {asset.zone_id}</p>
            <p>Position: [{asset.position.join(", ")}] m</p>
            {asset.dimensions && (
              <p>
                Size: {asset.dimensions.diameter_m ? `Ø${asset.dimensions.diameter_m}m` : ""}
                {asset.dimensions.height_m ? ` × ${asset.dimensions.height_m}m` : ""}
              </p>
            )}
            {asset.mesh_capability && (
              <p className="font-mono text-[11px] text-foreground/50">{asset.mesh_capability}</p>
            )}
            {live && (
              <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <p className="text-[10px] uppercase tracking-wider text-foreground/40">Live Status</p>
                <p className="mt-1 text-white">
                  Status: <span className={live.status === "on" ? "text-mesh-active" : "text-foreground/50"}>
                    {live.status}
                  </span>
                </p>
                {live.value !== undefined && <p className="mt-1 text-white">Value: {live.value}</p>}
              </div>
            )}
          </div>
        </>
      );
    }
  }

  if (selectedType === "sensor") {
    const sensor = spatialData.sensors.find((s) => s.sensor_id === selectedId);
    if (sensor) {
      content = (
        <>
          <div className="flex items-center gap-2 text-claw-accent">
            <Cpu size={16} />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Sensor</span>
          </div>
          <h3 className="mt-2 text-lg font-semibold text-white">{sensor.sensor_id}</h3>
          <div className="mt-3 space-y-2 text-sm text-foreground/70">
            <p>Type: {sensor.type.replace(/_/g, " ")}</p>
            <p>Zone: {sensor.zone_id}</p>
            <p>Position: [{sensor.position.join(", ")}] m</p>
            <p className="font-mono text-[11px] text-foreground/50">{sensor.mesh_capability}</p>
          </div>
        </>
      );
    }
  }

  if (selectedType === "line") {
    const line = spatialData.water_lines.find((l) => l.line_id === selectedId);
    if (line) {
      content = (
        <>
          <div className="flex items-center gap-2 text-mesh-info">
            <Waves size={16} />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Water Line</span>
          </div>
          <h3 className="mt-2 text-lg font-semibold text-white">{line.line_id}</h3>
          <div className="mt-3 space-y-2 text-sm text-foreground/70">
            <p>From: {line.from_asset}</p>
            <p>To: {line.to_asset ?? line.to_zone ?? "—"}</p>
            <p>Pipe: Ø{line.pipe_diameter_mm}mm {line.material}</p>
            <p>{line.buried ? "Buried" : "Surface"}</p>
            {line.drip_spacing_cm && (
              <p>Drip: {line.drip_spacing_cm}cm spacing, {line.drip_flow_lph} L/hr</p>
            )}
          </div>
        </>
      );
    }
  }

  if (selectedType === "crop") {
    const cluster = spatialData.crop_clusters.find((c) => c.cluster_id === selectedId);
    if (cluster) {
      content = (
        <>
          <div className="flex items-center gap-2 text-mesh-active">
            <span className="text-lg">🌳</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em]">{cluster.layer} layer</span>
          </div>
          <h3 className="mt-2 text-lg font-semibold text-white">{cluster.species}</h3>
          <div className="mt-3 space-y-2 text-sm text-foreground/70">
            {cluster.varieties && <p>Varieties: {cluster.varieties.join(", ")}</p>}
            <p>Zone: {cluster.zone_id}</p>
            <p>Avg height: {cluster.avg_height_m}m</p>
            <p>Spread: ~{cluster.radius_m}m radius</p>
            {cluster.tree_count_approx && <p>Trees: ~{cluster.tree_count_approx}</p>}
            {cluster.plant_count_approx && <p>Plants: ~{cluster.plant_count_approx}</p>}
          </div>
        </>
      );
    }
  }

  if (!content) return null;

  return (
    <div className="absolute right-4 top-4 z-20 w-72 rounded-2xl border border-white/10 bg-black/80 p-4 backdrop-blur-md">
      <button
        onClick={handleClose}
        className="absolute right-3 top-3 rounded-lg p-1 text-foreground/40 hover:text-white"
      >
        <X size={16} />
      </button>
      {content}
    </div>
  );
}

// Simple shoelace formula for polygon area
function calculatePolygonArea(polygon: [number, number][]): number {
  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i][0] * polygon[j][1];
    area -= polygon[j][0] * polygon[i][1];
  }
  return Math.abs(area) / 2;
}
