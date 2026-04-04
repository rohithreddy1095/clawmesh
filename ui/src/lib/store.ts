import { create } from "zustand";
import { mergeChatMessages } from "./chat-message-state";

// Copying necessary types from backend for UI
export type ContextFrameKind =
    | "observation"
    | "event"
    | "human_input"
    | "inference"
    | "capability_update"
    | "agent_response";

export type ContextFrame = {
    kind: ContextFrameKind;
    frameId: string;
    sourceDeviceId: string;
    sourceDisplayName?: string;
    timestamp: number;
    data: Record<string, unknown>;
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

export type ChatMessage = {
    id: string;
    conversationId: string;
    role: "human" | "agent";
    text: string;
    timestamp: number;
    citations?: Array<{ metric: string; value: unknown; zone?: string; timestamp: number }>;
    proposals?: string[];
    status?: "complete" | "queued" | "thinking" | "error";
};

export type Proposal = {
    taskId: string;
    summary: string;
    reasoning: string;
    targetRef: string;
    operation: string;
    operationParams?: Record<string, unknown>;
    approvalLevel: string;
    status: string;
    createdAt: number;
    resolvedAt?: number;
    resolvedBy?: string;
};

export type PlannerLeaderSummary = {
    kind: string;
    deviceId: string;
    role?: string;
};

export type PlannerActivitySummary = {
    state: string;
    role?: string;
    shouldHandleAutonomous?: boolean;
    leader: PlannerLeaderSummary;
};

export type RuntimeStaticPeer = {
    deviceId: string;
    url: string;
    transportLabel?: string;
    securityPosture?: string;
};

export type RuntimePendingProposal = {
    taskId: string;
    summary: string;
    approvalLevel: string;
    status: string;
    plannerDeviceId?: string;
    plannerRole?: string;
    plannerOwner?: string;
};

export type MeshRuntimeStatus = {
    localDeviceId: string;
    connectedPeers: number;
    peers: Array<{
        deviceId: string;
        displayName?: string;
        outbound: boolean;
        role?: string;
        transportLabel?: string;
        connectedAtMs: number;
    }>;
    plannerActivity?: PlannerActivitySummary;
    plannerMode?: string;
    plannerModelSpec?: string;
    discoveryEnabled?: boolean;
    configuredStaticPeers?: RuntimeStaticPeer[];
    pendingProposals?: RuntimePendingProposal[];
};

export type MeshRuntimeHealth = {
    status: string;
    nodeId: string;
    displayName?: string;
    uptimeMs: number;
    startedAt: string;
    peers: {
        connected: number;
        details: Array<{
            deviceId: string;
            displayName?: string;
            capabilities: string[];
            role?: string;
            transportLabel?: string;
            connectedMs: number;
            outbound: boolean;
        }>;
    };
    worldModel: {
        entries: number;
        frameLogSize: number;
    };
    capabilities: {
        local: string[];
        meshTotal: number;
    };
    plannerMode?: string;
    plannerModelSpec?: string;
    plannerLeader?: PlannerLeaderSummary;
    plannerActivity?: PlannerActivitySummary;
    discoveryEnabled?: boolean;
    configuredStaticPeers?: RuntimeStaticPeer[];
    memoryUsageMB?: number;
    version: string;
    timestamp: string;
};

export type MeshRuntimeEvent = {
    type: string;
    timestamp: number;
    message: string;
    data?: Record<string, unknown>;
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

    // Runtime status / heartbeat
    runtimeStatus: MeshRuntimeStatus | null;
    setRuntimeStatus: (status: MeshRuntimeStatus) => void;
    runtimeHealth: MeshRuntimeHealth | null;
    setRuntimeHealth: (health: MeshRuntimeHealth) => void;
    runtimeEvents: MeshRuntimeEvent[];
    setRuntimeEvents: (events: MeshRuntimeEvent[]) => void;

    // Chat messages
    chatMessages: ChatMessage[];
    addChatMessage: (msg: ChatMessage) => void;
    getChatHistory: (conversationId?: string) => ChatMessage[];

    // Proposals
    proposals: Record<string, Proposal>;
    addProposal: (proposal: Proposal) => void;
    updateProposalStatus: (taskId: string, status: string, resolvedBy?: string) => void;

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

    runtimeStatus: null,
    setRuntimeStatus: (status) => set({ runtimeStatus: status }),
    runtimeHealth: null,
    setRuntimeHealth: (health) => set({ runtimeHealth: health }),
    runtimeEvents: [],
    setRuntimeEvents: (events) => set({ runtimeEvents: events }),

    chatMessages: [],
    addChatMessage: (msg) =>
        set((state) => ({
            chatMessages: mergeChatMessages(state.chatMessages, msg),
        })),

    getChatHistory: (conversationId) => {
        const messages = get().chatMessages;
        if (conversationId) {
            return messages.filter((m) => m.conversationId === conversationId);
        }
        return messages;
    },

    proposals: {},
    addProposal: (proposal) =>
        set((state) => ({
            proposals: { ...state.proposals, [proposal.taskId]: proposal },
        })),

    updateProposalStatus: (taskId, status, resolvedBy) =>
        set((state) => {
            const existing = state.proposals[taskId];
            if (!existing) return state;
            return {
                proposals: {
                    ...state.proposals,
                    [taskId]: {
                        ...existing,
                        status,
                        resolvedBy,
                        resolvedAt: Date.now(),
                    },
                },
            };
        }),

    getLatestFrames: (limit = 50) => {
        const frames = get().frames;
        return frames.slice(-limit).reverse();
    },

    getFramesByKind: (kind) => {
        return get().frames.filter((f) => f.kind === kind).reverse();
    },
}));
