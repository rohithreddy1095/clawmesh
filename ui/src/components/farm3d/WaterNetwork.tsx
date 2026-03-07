"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { FarmWaterLine } from "@/lib/farm-spatial-types";

interface WaterNetworkProps {
  lines: FarmWaterLine[];
  selectedLineId: string | null;
  highlightAssetId?: string | null;   // Highlight all lines connected to this asset
  onLineClick: (lineId: string) => void;
}

// Pipe thickness based on diameter
function pipeRadius(diameter_mm: number): number {
  if (diameter_mm >= 63) return 0.4;      // mainline
  if (diameter_mm >= 32) return 0.25;     // subline
  return 0.08;                            // drip line
}

export function WaterNetwork({ lines, selectedLineId, highlightAssetId, onLineClick }: WaterNetworkProps) {
  return (
    <group>
      {lines.map((line) => (
        <WaterPipe
          key={line.line_id}
          line={line}
          selected={line.line_id === selectedLineId}
          highlighted={
            highlightAssetId != null &&
            (line.from_asset === highlightAssetId || line.to_asset === highlightAssetId)
          }
          onClick={() => onLineClick(line.line_id)}
        />
      ))}
    </group>
  );
}

interface WaterPipeProps {
  line: FarmWaterLine;
  selected: boolean;
  highlighted: boolean;
  onClick: () => void;
}

function WaterPipe({ line, selected, highlighted, onClick }: WaterPipeProps) {
  const { geometry, color, radius } = useMemo(() => {
    const pts = line.waypoints.map(
      // waypoints are [x, y, z] in farm-local coords
      // Three.js: x=east, y=up, z=south → swap y and z from data
      (wp) => new THREE.Vector3(wp[0], wp[1], wp[2])
    );

    // Create a smooth curve through waypoints
    const curve = pts.length >= 2
      ? new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5)
      : null;

    const r = pipeRadius(line.pipe_diameter_mm);

    let geo: THREE.TubeGeometry | null = null;
    if (curve) {
      const segments = Math.max(pts.length * 8, 16);
      geo = new THREE.TubeGeometry(curve, segments, r, 6, false);
    }

    return {
      geometry: geo,
      color: line.color || "#3B82F6",
      radius: r,
    };
  }, [line]);

  if (!geometry) return null;

  const finalColor = selected ? "#FF7844" : highlighted ? "#60A5FA" : color;
  const finalOpacity = line.buried ? (selected ? 0.8 : 0.5) : (selected ? 0.95 : 0.75);

  return (
    <mesh
      geometry={geometry}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <meshStandardMaterial
        color={finalColor}
        transparent
        opacity={finalOpacity}
        roughness={0.7}
        metalness={0.1}
      />
    </mesh>
  );
}
