"use client";

import { useRef, useMemo } from "react";
import * as THREE from "three";
import type { FarmZone, LayerFilter } from "@/lib/farm-spatial-types";

// Colors for the layer bands
const LAYER_COLORS: Record<string, string> = {
  canopy: "#166534",
  subcanopy: "#22C55E",
  shrub: "#86EFAC",
  ground: "#BBF7D0",
};

interface ZoneVolumeProps {
  zone: FarmZone;
  layerFilter: LayerFilter;
  selected: boolean;
  onClick: () => void;
  moisture?: number;
}

export function ZoneVolume({ zone, layerFilter, selected, onClick, moisture }: ZoneVolumeProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  // Create extruded shape from polygon
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    const pts = zone.polygon;
    if (pts.length < 3) return null;

    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      s.lineTo(pts[i][0], pts[i][1]);
    }
    s.closePath();
    return s;
  }, [zone.polygon]);

  // Build the layer bands
  const layers = useMemo(() => {
    if (!shape || !zone.layer_heights) return [];
    const h = zone.layer_heights;
    const bands: Array<{ name: string; bottom: number; top: number; color: string }> = [];

    if (h.ground_top && layerFilter.ground) {
      bands.push({ name: "ground", bottom: 0, top: h.ground_top, color: LAYER_COLORS.ground });
    }
    if (h.shrub_top && layerFilter.shrub) {
      bands.push({ name: "shrub", bottom: h.ground_top ?? 0, top: h.shrub_top, color: LAYER_COLORS.shrub });
    }
    if (h.subcanopy_top && layerFilter.subcanopy) {
      bands.push({ name: "subcanopy", bottom: h.shrub_top ?? 0, top: h.subcanopy_top, color: LAYER_COLORS.subcanopy });
    }
    if (h.canopy_top && layerFilter.canopy) {
      bands.push({ name: "canopy", bottom: h.subcanopy_top ?? 0, top: h.canopy_top, color: LAYER_COLORS.canopy });
    }

    return bands;
  }, [shape, zone.layer_heights, layerFilter]);

  if (!shape) return null;

  // Ground plate color — shift toward blue if wet, toward orange if dry
  const groundColor = useMemo(() => {
    if (moisture === undefined) return zone.color;
    // Interpolate: dry (0%) = orange, wet (100%) = blue
    const t = moisture / 100;
    const r = Math.round(200 * (1 - t) + 59 * t);
    const g = Math.round(120 * (1 - t) + 130 * t);
    const b = Math.round(50 * (1 - t) + 246 * t);
    return `rgb(${r},${g},${b})`;
  }, [moisture, zone.color]);

  return (
    <group>
      {/* Ground plate */}
      <mesh
        ref={meshRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, zone.elevation_base + 0.05, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial
          color={groundColor}
          transparent
          opacity={selected ? 0.45 : zone.opacity}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Selection outline */}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, zone.elevation_base + 0.1, 0]}>
          <shapeGeometry args={[shape]} />
          <meshBasicMaterial color="#FF7844" transparent opacity={0.3} wireframe side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Layer bands (semi-transparent vertical extrusions) */}
      {layers.map((layer) => (
        <mesh
          key={layer.name}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, layer.bottom, 0]}
        >
          <extrudeGeometry
            args={[
              shape,
              {
                depth: layer.top - layer.bottom,
                bevelEnabled: false,
              },
            ]}
          />
          <meshStandardMaterial
            color={layer.color}
            transparent
            opacity={0.06}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}

      {/* Zone label */}
      <group position={[
        zone.polygon.reduce((s, p) => s + p[0], 0) / zone.polygon.length,
        (zone.layer_heights?.canopy_top ?? 1) + 1,
        zone.polygon.reduce((s, p) => s + p[1], 0) / zone.polygon.length,
      ]}>
        {/* We'll use Html from drei for labels - placeholder sprite */}
      </group>
    </group>
  );
}
