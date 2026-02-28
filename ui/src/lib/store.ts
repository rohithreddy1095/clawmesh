import { create } from "zustand";

// Copying necessary types from backend for UI
export type ContextFrameKind =
    | "observation"
    | "event"
    | "human_input"
    | "inference"
    | "capability_update";

export type ContextFrame = {
    kind: ContextFrameKind;
    frameId: string;
    sourceDeviceId: string;
    sourceDisplayName?: string;
    timestamp: number;
    data: Record<string, any>;
    trust: {
        evidence_sources: string[];
        evidence_trust_tier: string;
    };
    note?: string;
};

export type MeshPeer = {
    deviceId: string;
    displayName?: string;
    capabilities: string[];
    lastSeenMs: number;
};

interface MeshState {
    // Connection state
    isConnected: boolean;
    setConnected: (status: boolean) => void;

    // Active peers in the mesh
    peers: Record<string, MeshPeer>;
    setPeers: (peers: MeshPeer[]) => void;

    // World Model (Context Frames)
    frames: ContextFrame[];
    addFrame: (frame: ContextFrame) => void;

    // Computed state getters
    getLatestFrames: (limit?: number) => ContextFrame[];
    getFramesByKind: (kind: ContextFrameKind) => ContextFrame[];
}

export const useMeshStore = create<MeshState>((set, get) => ({
    isConnected: false,
    setConnected: (status) => set({ isConnected: status }),

    peers: {},
    setPeers: (peerList) => {
        const peerMap: Record<string, MeshPeer> = {};
        for (const p of peerList) {
            peerMap[p.deviceId] = p;
        }
        set({ peers: peerMap });
    },

    frames: [],
    addFrame: (frame) =>
        set((state) => {
            // Deduplicate by frameId
            if (state.frames.some((f) => f.frameId === frame.frameId)) {
                return state;
            }

            const newFrames = [...state.frames, frame];
            // Keep last 500 frames in UI
            if (newFrames.length > 500) {
                newFrames.shift();
            }
            return { frames: newFrames };
        }),

    getLatestFrames: (limit = 50) => {
        const frames = get().frames;
        return frames.slice(-limit).reverse();
    },

    getFramesByKind: (kind) => {
        return get().frames.filter((f) => f.kind === kind).reverse();
    },
}));
