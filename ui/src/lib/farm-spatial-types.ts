// Types for the spatial farm data model
// Maps directly to farm/bhoomi/spatial/scene-placeholder-v0.yaml

export interface FarmCoordinateSystem {
  type: string;
  origin_label: string;
  axes: { x: string; y: string; z: string };
  geo_anchor: {
    lat: number | null;
    lon: number | null;
    bearing_deg: number | null;
  };
  farm_bounds: {
    x_min: number;
    x_max: number;
    z_min: number;
    z_max: number;
  };
}

export interface FarmZone {
  zone_id: string;
  polygon: [number, number][];  // [x, z] vertices in farm-local meters
  elevation_base: number;
  layer_heights?: {
    canopy_top?: number;
    subcanopy_top?: number;
    shrub_top?: number;
    ground_top?: number;
  };
  color: string;
  opacity: number;
}

export interface FarmAsset {
  asset_id: string;
  type: string;
  position: [number, number, number]; // [x, y, z]
  dimensions?: {
    diameter_m?: number;
    height_m?: number;
    width_m?: number;
    length_m?: number;
  };
  model_hint?: string;
  zone_id: string;
  mesh_capability?: string;
}

export interface FarmSensor {
  sensor_id: string;
  type: string;
  position: [number, number, number];
  zone_id: string;
  mesh_capability: string;
  model_hint?: string;
}

export interface FarmWaterLine {
  line_id: string;
  from_asset: string;
  to_asset?: string;
  to_zone?: string;
  waypoints: [number, number, number][];
  pipe_diameter_mm: number;
  material: string;
  buried: boolean;
  color: string;
  drip_spacing_cm?: number;
  drip_flow_lph?: number;
}

export interface FarmCropCluster {
  cluster_id: string;
  zone_id: string;
  layer: 'canopy' | 'subcanopy' | 'shrub' | 'ground';
  species: string;
  varieties?: string[];
  centroid: [number, number, number]; // [x, y, z]
  radius_m: number;
  tree_count_approx?: number;
  plant_count_approx?: number;
  avg_height_m: number;
  model_hint: string;
}

export interface FarmSpatialData {
  schema_version: string;
  status: string;
  coordinate_system: FarmCoordinateSystem;
  zones: FarmZone[];
  assets: FarmAsset[];
  sensors: FarmSensor[];
  water_lines: FarmWaterLine[];
  crop_clusters: FarmCropCluster[];
}

// Live state types (from mesh sensor data)
export interface ZoneLiveState {
  zone_id: string;
  moisture?: number;       // 0-100%
  temperature?: number;    // °C
  lastUpdate: number;      // timestamp ms
}

export interface AssetLiveState {
  asset_id: string;
  status: 'on' | 'off' | 'unknown';
  value?: number;          // e.g., tank level %, flow rate
  lastUpdate: number;
}

export type ViewMode = 'design' | 'operations' | 'water' | 'layers';

export type LayerFilter = {
  canopy: boolean;
  subcanopy: boolean;
  shrub: boolean;
  ground: boolean;
};
