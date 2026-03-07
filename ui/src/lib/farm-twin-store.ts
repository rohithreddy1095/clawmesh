import { create } from "zustand";
import type {
  FarmSpatialData,
  ZoneLiveState,
  AssetLiveState,
  ViewMode,
  LayerFilter,
} from "./farm-spatial-types";

interface FarmTwinState {
  // Static spatial data (loaded from YAML/JSON)
  spatialData: FarmSpatialData | null;
  setSpatialData: (data: FarmSpatialData) => void;

  // Live state from mesh sensors
  zoneLive: Record<string, ZoneLiveState>;
  assetLive: Record<string, AssetLiveState>;
  updateZoneLive: (zoneId: string, update: Partial<ZoneLiveState>) => void;
  updateAssetLive: (assetId: string, update: Partial<AssetLiveState>) => void;

  // View controls
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  layerFilter: LayerFilter;
  setLayerFilter: (filter: Partial<LayerFilter>) => void;

  // Selection
  selectedId: string | null;
  selectedType: 'zone' | 'asset' | 'sensor' | 'line' | 'crop' | null;
  select: (id: string | null, type: 'zone' | 'asset' | 'sensor' | 'line' | 'crop' | null) => void;

  // Camera
  focusTarget: [number, number, number] | null;
  setFocusTarget: (target: [number, number, number] | null) => void;
}

export const useFarmTwinStore = create<FarmTwinState>((set) => ({
  spatialData: null,
  setSpatialData: (data) => set({ spatialData: data }),

  zoneLive: {},
  assetLive: {},
  updateZoneLive: (zoneId, update) =>
    set((state) => ({
      zoneLive: {
        ...state.zoneLive,
        [zoneId]: {
          zone_id: zoneId,
          ...state.zoneLive[zoneId],
          ...update,
          lastUpdate: Date.now(),
        },
      },
    })),
  updateAssetLive: (assetId, update) =>
    set((state) => ({
      assetLive: {
        ...state.assetLive,
        [assetId]: {
          asset_id: assetId,
          ...state.assetLive[assetId],
          ...update,
          lastUpdate: Date.now(),
        },
      },
    })),

  viewMode: "operations",
  setViewMode: (mode) => set({ viewMode: mode }),

  layerFilter: { canopy: true, subcanopy: true, shrub: true, ground: true },
  setLayerFilter: (filter) =>
    set((state) => ({
      layerFilter: { ...state.layerFilter, ...filter },
    })),

  selectedId: null,
  selectedType: null,
  select: (id, type) => set({ selectedId: id, selectedType: type }),

  focusTarget: null,
  setFocusTarget: (target) => set({ focusTarget: target }),
}));
