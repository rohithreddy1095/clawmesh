"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { FarmCoordinateSystem } from "@/lib/farm-spatial-types";

interface GroundPlaneProps {
  coords: FarmCoordinateSystem;
}

export function GroundPlane({ coords }: GroundPlaneProps) {
  const { x_min, x_max, z_min, z_max } = coords.farm_bounds;
  const width = x_max - x_min;
  const depth = z_max - z_min;
  const cx = (x_min + x_max) / 2;
  const cz = (z_min + z_max) / 2;

  // Grid helper lines
  const gridLines = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const step = 20; // grid every 20m

    // X-parallel lines (running east-west)
    for (let z = z_min; z <= z_max; z += step) {
      pts.push(new THREE.Vector3(x_min, 0, z));
      pts.push(new THREE.Vector3(x_max, 0, z));
    }
    // Z-parallel lines (running north-south)
    for (let x = x_min; x <= x_max; x += step) {
      pts.push(new THREE.Vector3(x, 0, z_min));
      pts.push(new THREE.Vector3(x, 0, z_max));
    }

    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    return geo;
  }, [x_min, x_max, z_min, z_max]);

  // Farm boundary outline
  const boundaryLine = useMemo(() => {
    const pts = [
      new THREE.Vector3(x_min, 0.02, z_min),
      new THREE.Vector3(x_max, 0.02, z_min),
      new THREE.Vector3(x_max, 0.02, z_max),
      new THREE.Vector3(x_min, 0.02, z_max),
      new THREE.Vector3(x_min, 0.02, z_min),
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(pts);
    const material = new THREE.LineBasicMaterial({
      color: "#FF7844",
      transparent: true,
      opacity: 0.5,
    });
    return new THREE.Line(geometry, material);
  }, [x_min, x_max, z_min, z_max]);

  return (
    <group>
      {/* Ground surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.01, cz]}>
        <planeGeometry args={[width + 20, depth + 20]} />
        <meshStandardMaterial
          color="#1A1A2E"
          transparent
          opacity={0.85}
          roughness={1}
        />
      </mesh>

      {/* Grid lines */}
      <lineSegments geometry={gridLines}>
        <lineBasicMaterial color="#FFFFFF" transparent opacity={0.06} />
      </lineSegments>

      {/* Farm boundary */}
      <primitive object={boundaryLine} />

      {/* Origin marker (small axis indicator) */}
      <group position={[x_min - 3, 0, z_min - 3]}>
        {/* X axis (East) - red */}
        <mesh position={[2, 0.1, 0]}>
          <boxGeometry args={[4, 0.1, 0.1]} />
          <meshBasicMaterial color="#EF4444" />
        </mesh>
        {/* Z axis (South) - blue */}
        <mesh position={[0, 0.1, 2]}>
          <boxGeometry args={[0.1, 0.1, 4]} />
          <meshBasicMaterial color="#3B82F6" />
        </mesh>
        {/* Y axis (Up) - green */}
        <mesh position={[0, 2, 0]}>
          <boxGeometry args={[0.1, 4, 0.1]} />
          <meshBasicMaterial color="#22C55E" />
        </mesh>
      </group>
    </group>
  );
}
