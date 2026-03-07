"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html, Environment } from "@react-three/drei";
import { useFarmTwinStore } from "@/lib/farm-twin-store";
import type { FarmSpatialData } from "@/lib/farm-spatial-types";

import { GroundPlane } from "./GroundPlane";
import { ZoneVolume } from "./ZoneVolume";
import { WaterNetwork } from "./WaterNetwork";
import { InfraAsset, SensorMarker } from "./InfraAsset";
import { CropLayer } from "./CropLayer";

interface FarmSceneProps {
  data: FarmSpatialData;
}

function SceneContent({ data }: FarmSceneProps) {
  const {
    selectedId,
    selectedType,
    select,
    viewMode,
    layerFilter,
    zoneLive,
    assetLive,
  } = useFarmTwinStore();

  const bounds = data.coordinate_system.farm_bounds;
  const centerX = (bounds.x_min + bounds.x_max) / 2;
  const centerZ = (bounds.z_min + bounds.z_max) / 2;

  // In water view, dim non-water elements
  const isWaterView = viewMode === "water";

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[centerX + 80, 60, centerZ - 60]}
        intensity={0.8}
        castShadow={false}
      />
      <directionalLight
        position={[centerX - 40, 40, centerZ + 40]}
        intensity={0.3}
      />

      {/* Ground */}
      <GroundPlane coords={data.coordinate_system} />

      {/* Zones */}
      <group visible={!isWaterView || true}>
        {data.zones.map((zone) => (
          <ZoneVolume
            key={zone.zone_id}
            zone={zone}
            layerFilter={layerFilter}
            selected={selectedId === zone.zone_id && selectedType === "zone"}
            onClick={() => select(zone.zone_id, "zone")}
            moisture={zoneLive[zone.zone_id]?.moisture}
          />
        ))}
      </group>

      {/* Water network (always visible, highlighted in water view) */}
      <WaterNetwork
        lines={data.water_lines}
        selectedLineId={selectedType === "line" ? selectedId : null}
        highlightAssetId={
          isWaterView && selectedType === "asset" ? selectedId : null
        }
        onLineClick={(id) => select(id, "line")}
      />

      {/* Infrastructure assets */}
      {data.assets.map((asset) => (
        <InfraAsset
          key={asset.asset_id}
          asset={asset}
          selected={selectedId === asset.asset_id && selectedType === "asset"}
          liveStatus={assetLive[asset.asset_id]?.status}
          liveValue={assetLive[asset.asset_id]?.value}
          onClick={() => select(asset.asset_id, "asset")}
        />
      ))}

      {/* Sensors */}
      {data.sensors.map((sensor) => (
        <SensorMarker
          key={sensor.sensor_id}
          sensor={sensor}
          selected={selectedId === sensor.sensor_id && selectedType === "sensor"}
          onClick={() => select(sensor.sensor_id, "sensor")}
        />
      ))}

      {/* Crop clusters (hidden in water view) */}
      {!isWaterView && (
        <CropLayer
          clusters={data.crop_clusters}
          layerFilter={layerFilter}
          selectedClusterId={selectedType === "crop" ? selectedId : null}
          onClusterClick={(id) => select(id, "crop")}
        />
      )}

      {/* Zone labels (floating HTML) */}
      {data.zones.map((zone) => {
        const cx = zone.polygon.reduce((s, p) => s + p[0], 0) / zone.polygon.length;
        const cz = zone.polygon.reduce((s, p) => s + p[1], 0) / zone.polygon.length;
        const topY = zone.layer_heights?.canopy_top ?? 2;

        return (
          <Html
            key={zone.zone_id}
            position={[cx, topY + 2, cz]}
            center
            distanceFactor={120}
            style={{ pointerEvents: "none" }}
          >
            <div className="whitespace-nowrap rounded-lg border border-white/10 bg-black/70 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-white/70 backdrop-blur-sm">
              {zone.zone_id.replace("z-", "")}
            </div>
          </Html>
        );
      })}
    </>
  );
}

export function FarmScene({ data }: FarmSceneProps) {
  const bounds = data.coordinate_system.farm_bounds;
  const centerX = (bounds.x_min + bounds.x_max) / 2;
  const centerZ = (bounds.z_min + bounds.z_max) / 2;
  const extent = Math.max(
    bounds.x_max - bounds.x_min,
    bounds.z_max - bounds.z_min
  );

  return (
    <Canvas
      camera={{
        position: [centerX - extent * 0.3, extent * 0.6, centerZ - extent * 0.5],
        fov: 45,
        near: 0.5,
        far: 2000,
      }}
      style={{ background: "transparent" }}
      gl={{ antialias: true, alpha: true }}
    >
      <Suspense
        fallback={
          <Html center>
            <div className="text-sm text-white/50">Loading farm...</div>
          </Html>
        }
      >
        <SceneContent data={data} />
      </Suspense>

      <OrbitControls
        target={[centerX, 0, centerZ]}
        enableDamping
        dampingFactor={0.1}
        minDistance={10}
        maxDistance={extent * 2}
        maxPolarAngle={Math.PI / 2 - 0.05}
      />
    </Canvas>
  );
}
