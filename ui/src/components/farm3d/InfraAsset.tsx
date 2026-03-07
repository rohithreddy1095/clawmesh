"use client";

import { useRef } from "react";
import * as THREE from "three";
import type { FarmAsset, FarmSensor } from "@/lib/farm-spatial-types";

// ─── Infrastructure Assets (pumps, tanks, valves, etc.) ─────────────────

interface InfraAssetProps {
  asset: FarmAsset;
  selected: boolean;
  liveStatus?: "on" | "off" | "unknown";
  liveValue?: number;
  onClick: () => void;
}

const ASSET_COLORS: Record<string, string> = {
  pump: "#3B82F6",
  tank_overhead: "#06B6D4",
  filter: "#8B5CF6",
  manifold: "#6366F1",
  valve: "#EAB308",
};

export function InfraAsset({ asset, selected, liveStatus, onClick }: InfraAssetProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const baseColor = ASSET_COLORS[asset.type] ?? "#94A3B8";
  const color = selected ? "#FF7844" : liveStatus === "on" ? "#22C55E" : baseColor;

  const [px, py, pz] = asset.position;

  // Different geometry per type
  if (asset.type === "tank_overhead") {
    const d = asset.dimensions?.diameter_m ?? 3;
    const h = asset.dimensions?.height_m ?? 2;
    return (
      <group position={[px, py, pz]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        {/* Tank body */}
        <mesh ref={meshRef} position={[0, h / 2, 0]}>
          <cylinderGeometry args={[d / 2, d / 2, h, 16]} />
          <meshStandardMaterial color={color} transparent opacity={0.7} />
        </mesh>
        {/* Water level indicator (just a visual fill) */}
        <mesh position={[0, h * 0.4, 0]}>
          <cylinderGeometry args={[d / 2 - 0.05, d / 2 - 0.05, h * 0.8, 16]} />
          <meshStandardMaterial color="#0EA5E9" transparent opacity={0.3} />
        </mesh>
        {/* Selection ring */}
        {selected && (
          <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[d / 2 + 0.2, d / 2 + 0.5, 24]} />
            <meshBasicMaterial color="#FF7844" transparent opacity={0.6} side={THREE.DoubleSide} />
          </mesh>
        )}
      </group>
    );
  }

  if (asset.type === "pump") {
    return (
      <group position={[px, py, pz]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <mesh ref={meshRef} position={[0, 0.4, 0]}>
          <boxGeometry args={[0.8, 0.8, 0.6]} />
          <meshStandardMaterial color={color} transparent opacity={0.8} />
        </mesh>
        {/* Motor cylinder */}
        <mesh position={[0, 0.8, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.25, 0.25, 0.6, 8]} />
          <meshStandardMaterial color={liveStatus === "on" ? "#22C55E" : "#64748B"} />
        </mesh>
        {selected && (
          <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.8, 1.1, 16]} />
            <meshBasicMaterial color="#FF7844" transparent opacity={0.6} side={THREE.DoubleSide} />
          </mesh>
        )}
      </group>
    );
  }

  if (asset.type === "valve") {
    return (
      <group position={[px, py, pz]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        {/* Valve body */}
        <mesh ref={meshRef} position={[0, 0.15, 0]}>
          <cylinderGeometry args={[0.2, 0.2, 0.3, 8]} />
          <meshStandardMaterial color={color} transparent opacity={0.85} />
        </mesh>
        {/* Handle */}
        <mesh position={[0, 0.35, 0]}>
          <boxGeometry args={[0.4, 0.05, 0.05]} />
          <meshStandardMaterial color={liveStatus === "on" ? "#22C55E" : "#DC2626"} />
        </mesh>
        {selected && (
          <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.3, 0.5, 12]} />
            <meshBasicMaterial color="#FF7844" transparent opacity={0.6} side={THREE.DoubleSide} />
          </mesh>
        )}
      </group>
    );
  }

  // Default: generic box
  return (
    <group position={[px, py, pz]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <mesh ref={meshRef} position={[0, 0.3, 0]}>
        <boxGeometry args={[0.6, 0.6, 0.6]} />
        <meshStandardMaterial color={color} transparent opacity={0.7} />
      </mesh>
    </group>
  );
}

// ─── Sensors ───────────────────────────────────────────────────────────

interface SensorMarkerProps {
  sensor: FarmSensor;
  selected: boolean;
  onClick: () => void;
}

const SENSOR_COLORS: Record<string, string> = {
  soil_moisture: "#0EA5E9",
  soil_temperature: "#F59E0B",
  weather_station: "#8B5CF6",
  tank_level: "#06B6D4",
  flow_meter: "#3B82F6",
};

export function SensorMarker({ sensor, selected, onClick }: SensorMarkerProps) {
  const color = selected ? "#FF7844" : SENSOR_COLORS[sensor.type] ?? "#94A3B8";
  const [px, py, pz] = sensor.position;

  if (sensor.type === "weather_station") {
    // Tall pole with sphere on top
    return (
      <group position={[px, 0, pz]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        {/* Pole */}
        <mesh position={[0, py / 2, 0]}>
          <cylinderGeometry args={[0.04, 0.06, py, 6]} />
          <meshStandardMaterial color="#94A3B8" />
        </mesh>
        {/* Station head */}
        <mesh position={[0, py, 0]}>
          <sphereGeometry args={[0.2, 8, 8]} />
          <meshStandardMaterial color={color} />
        </mesh>
        {/* Horizontal arms */}
        <mesh position={[0, py - 0.1, 0]}>
          <boxGeometry args={[0.6, 0.03, 0.03]} />
          <meshStandardMaterial color="#94A3B8" />
        </mesh>
        {selected && (
          <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.3, 0.5, 12]} />
            <meshBasicMaterial color="#FF7844" transparent opacity={0.6} side={THREE.DoubleSide} />
          </mesh>
        )}
      </group>
    );
  }

  // Soil sensors: small probe sticking up from ground
  const probeHeight = Math.abs(py) + 0.2; // visible above ground
  return (
    <group position={[px, 0, pz]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {/* Probe body (partially underground) */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.06, 0.04, probeHeight, 6]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* Top indicator dot */}
      <mesh position={[0, probeHeight / 2 + 0.1, 0]}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 0.8 : 0.3}
        />
      </mesh>
      {selected && (
        <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.15, 0.3, 12]} />
          <meshBasicMaterial color="#FF7844" transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}
