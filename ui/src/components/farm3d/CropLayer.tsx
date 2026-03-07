"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { FarmCropCluster, LayerFilter } from "@/lib/farm-spatial-types";

interface CropLayerProps {
  clusters: FarmCropCluster[];
  layerFilter: LayerFilter;
  selectedClusterId: string | null;
  onClusterClick: (clusterId: string) => void;
}

// Visual style per layer
const LAYER_STYLE: Record<string, { color: string; shape: 'sphere' | 'cone' | 'cylinder' | 'disc' }> = {
  canopy:    { color: "#166534", shape: "sphere" },
  subcanopy: { color: "#15803D", shape: "sphere" },
  shrub:     { color: "#65A30D", shape: "cylinder" },
  ground:    { color: "#A3E635", shape: "disc" },
};

export function CropLayer({ clusters, layerFilter, selectedClusterId, onClusterClick }: CropLayerProps) {
  // Filter clusters by active layer toggles
  const visible = clusters.filter((c) => {
    const k = c.layer as keyof LayerFilter;
    return layerFilter[k] !== false;
  });

  return (
    <group>
      {visible.map((cluster) => (
        <CropClusterViz
          key={cluster.cluster_id}
          cluster={cluster}
          selected={cluster.cluster_id === selectedClusterId}
          onClick={() => onClusterClick(cluster.cluster_id)}
        />
      ))}
    </group>
  );
}

interface CropClusterVizProps {
  cluster: FarmCropCluster;
  selected: boolean;
  onClick: () => void;
}

function CropClusterViz({ cluster, selected, onClick }: CropClusterVizProps) {
  const style = LAYER_STYLE[cluster.layer] ?? LAYER_STYLE.ground;
  const color = selected ? "#FF7844" : style.color;
  const [cx, , cz] = cluster.centroid;
  const h = cluster.avg_height_m;
  const r = cluster.radius_m;

  // Generate scattered tree/plant positions within the radius
  const positions = useMemo(() => {
    const count = cluster.tree_count_approx ?? cluster.plant_count_approx ?? Math.ceil(r * 2);
    // Cap at reasonable instance count for performance
    const n = Math.min(count, 50);
    const pts: [number, number, number][] = [];

    // Deterministic scatter using cluster_id as seed
    let seed = 0;
    for (const ch of cluster.cluster_id) seed = ((seed << 5) - seed + ch.charCodeAt(0)) | 0;

    const mulberry = (s: number) => {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let i = 0; i < n; i++) {
      const angle = mulberry(seed + i * 3) * Math.PI * 2;
      const dist = Math.sqrt(mulberry(seed + i * 3 + 1)) * r * 0.9;
      const heightVar = 0.7 + mulberry(seed + i * 3 + 2) * 0.6; // 70%-130% height variation
      pts.push([
        cx + Math.cos(angle) * dist,
        h * heightVar,
        cz + Math.sin(angle) * dist,
      ]);
    }
    return pts;
  }, [cluster.cluster_id, cx, cz, r, h, cluster.tree_count_approx, cluster.plant_count_approx]);

  if (cluster.layer === "ground") {
    // Ground cover: flat disc
    return (
      <group onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <mesh position={[cx, 0.15, cz]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[r, 24]} />
          <meshStandardMaterial
            color={color}
            transparent
            opacity={selected ? 0.5 : 0.25}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    );
  }

  if (cluster.layer === "shrub") {
    // Shrubs: small cylinders
    return (
      <group onClick={(e) => { e.stopPropagation(); onClick(); }}>
        {positions.map((pos, i) => (
          <mesh key={i} position={[pos[0], pos[1] / 2, pos[2]]}>
            <cylinderGeometry args={[0.3, 0.4, pos[1], 6]} />
            <meshStandardMaterial
              color={color}
              transparent
              opacity={0.5}
            />
          </mesh>
        ))}
      </group>
    );
  }

  // Canopy and subcanopy: tree-like shapes (trunk + crown)
  return (
    <group onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {positions.map((pos, i) => {
        const treeH = pos[1];
        const crownR = cluster.layer === "canopy"
          ? 1.5 + (treeH / h) * 1.5
          : 0.8 + (treeH / h) * 0.8;

        return (
          <group key={i} position={[pos[0], 0, pos[2]]}>
            {/* Trunk */}
            <mesh position={[0, treeH * 0.4, 0]}>
              <cylinderGeometry args={[0.08, 0.12, treeH * 0.8, 5]} />
              <meshStandardMaterial color="#78350F" />
            </mesh>
            {/* Crown */}
            <mesh position={[0, treeH * 0.75, 0]}>
              <sphereGeometry args={[crownR, 8, 6]} />
              <meshStandardMaterial
                color={color}
                transparent
                opacity={0.55}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
