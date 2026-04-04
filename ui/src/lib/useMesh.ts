"use client";

import { useEffect, useRef, useCallback } from "react";
import {
    useMeshStore,
    type ContextFrame,
    type MeshPeer,
    type Proposal,
    type MeshRuntimeHealth,
    type MeshRuntimeStatus,
} from "./store";

const DEFAULT_WS_URL = typeof window !== "undefined"
  ? `ws://${window.location.hostname}:18789`
  : "ws://localhost:18789";

const WS_URL = process.env.NEXT_PUBLIC_MESH_URL || DEFAULT_WS_URL;

/** Fallback for mobile browsers on non-HTTPS where uuid() is unavailable. */
function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

type MeshCommandParams = {
    to: string;
    targetRef: string;
    operation: string;
    operationParams?: Record<string, unknown>;
    note?: string;
};

export function useMesh() {
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
    const runtimePollInterval = useRef<NodeJS.Timeout | null>(null);

    const {
        isConnected,
        setConnected,
        setPeers,
        addFrame,
        setRuntimeStatus,
        setRuntimeHealth,
        setRuntimeEvents,
        addChatMessage,
        addProposal,
        updateProposalStatus,
    } = useMeshStore();

    useEffect(() => {
        function requestRuntimeSnapshot(ws: WebSocket) {
            ws.send(JSON.stringify({ type: "req", id: `mesh-peers-${uuid()}`, method: "mesh.peers" }));
            ws.send(JSON.stringify({ type: "req", id: `mesh-status-${uuid()}`, method: "mesh.status" }));
            ws.send(JSON.stringify({ type: "req", id: `mesh-health-${uuid()}`, method: "mesh.health" }));
            ws.send(JSON.stringify({ type: "req", id: `mesh-events-${uuid()}`, method: "mesh.events", params: { limit: 20 } }));
        }

        function connect() {
            if (wsRef.current?.readyState === WebSocket.OPEN) return;

            const ws = new WebSocket(WS_URL);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log("[useMesh] Connected to local mesh node");
                setConnected(true);

                // Subscribe to chat events
                ws.send(JSON.stringify({ type: "req", id: uuid(), method: "chat.subscribe" }));
                requestRuntimeSnapshot(ws);

                if (runtimePollInterval.current) clearInterval(runtimePollInterval.current);
                runtimePollInterval.current = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        requestRuntimeSnapshot(ws);
                    }
                }, 5000);
            };

            ws.onclose = () => {
                console.log("[useMesh] Disconnected from mesh node");
                setConnected(false);
                if (runtimePollInterval.current) {
                    clearInterval(runtimePollInterval.current);
                    runtimePollInterval.current = null;
                }
                reconnectTimeout.current = setTimeout(connect, 3000);
            };

            ws.onerror = () => {
                // Silently handle connection errors
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);

                    // Handle incoming context gossip events
                    if (msg.type === "event" && msg.event === "context.frame") {
                        const frame = msg.payload as ContextFrame;
                        addFrame(frame);

                        // Route agent_response frames to chat
                        if (frame.kind === "agent_response") {
                            const data = frame.data;
                            const status = data.status as string;
                            addChatMessage({
                                id: frame.frameId,
                                conversationId: (data.conversationId as string) || "default",
                                role: "agent",
                                text: (data.message as string) || "",
                                timestamp: frame.timestamp,
                                citations: data.citations as any,
                                proposals: data.proposals as string[],
                                status: status as "complete" | "queued" | "thinking" | "error",
                            });
                        }
                    }

                    // Handle planner proposals
                    if (msg.type === "event" && msg.event === "planner.proposal") {
                        const proposal = msg.payload as Proposal;
                        addProposal(proposal);
                    }

                    // Handle proposal resolution
                    if (msg.type === "event" && msg.event === "planner.proposal.resolved") {
                        const proposal = msg.payload as Proposal;
                        updateProposalStatus(proposal.taskId, proposal.status, proposal.resolvedBy);
                    }

                    if (msg.type === "res" && msg.ok && typeof msg.id === "string") {
                        if (msg.id.startsWith("mesh-peers-") && msg.payload?.peers) {
                            setPeers(msg.payload.peers as MeshPeer[]);
                        }

                        if (msg.id.startsWith("mesh-status-") && msg.payload?.localDeviceId) {
                            setRuntimeStatus(msg.payload as MeshRuntimeStatus);
                        }

                        if (msg.id.startsWith("mesh-health-") && msg.payload?.nodeId) {
                            setRuntimeHealth(msg.payload as MeshRuntimeHealth);
                        }

                        if (msg.id.startsWith("mesh-events-") && Array.isArray(msg.payload?.events)) {
                            setRuntimeEvents(msg.payload.events);
                        }
                    }

                    // Legacy generic peers response fallback
                    if (msg.type === "res" && msg.ok && msg.payload?.peers && !msg.id) {
                        setPeers(msg.payload.peers as MeshPeer[]);
                    }

                } catch (e) {
                    console.error("[useMesh] Failed to parse message", e);
                }
            };
        }

        connect();

        return () => {
            if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
            if (runtimePollInterval.current) clearInterval(runtimePollInterval.current);
            if (wsRef.current) wsRef.current.close();
        };
    }, [setConnected, setPeers, setRuntimeStatus, setRuntimeHealth, setRuntimeEvents, addFrame, addChatMessage, addProposal, updateProposalStatus]);

    // Command to send mesh forwards
    const sendCommand = useCallback((params: MeshCommandParams) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        wsRef.current.send(JSON.stringify({
            type: "req",
            id: uuid(),
            method: "mesh.message.forward",
            params: {
                channel: "clawmesh",
                to: params.to,
                originGatewayId: "ui-client",
                idempotencyKey: uuid(),
                commandDraft: {
                    source: { nodeId: "ui-client", role: "operator" },
                    target: { kind: "capability", ref: params.targetRef },
                    operation: { name: params.operation, params: params.operationParams },
                    note: params.note
                }
            }
        }));
    }, []);

    /**
     * Send a chat message to the Pi agent. Returns the conversationId.
     */
    const sendChat = useCallback((text: string, existingConversationId?: string): string => {
        const conversationId = existingConversationId || uuid();
        const requestId = uuid();

        // Add optimistic human message to store
        addChatMessage({
            id: requestId,
            conversationId,
            role: "human",
            text,
            timestamp: Date.now(),
            status: "complete",
        });

        // Send to backend
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: "req",
                id: uuid(),
                method: "mesh.message.forward",
                params: {
                    channel: "clawmesh",
                    to: "agent:pi",
                    originGatewayId: "ui-client",
                    idempotencyKey: uuid(),
                    commandDraft: {
                        source: { nodeId: "ui-client", role: "operator" },
                        target: { kind: "capability", ref: "agent:pi" },
                        operation: {
                            name: "intent:parse",
                            params: { text, conversationId, requestId },
                        },
                    },
                },
            }));
        }

        return conversationId;
    }, [addChatMessage]);

    /**
     * Approve a proposal via RPC.
     */
    const approveProposal = useCallback((taskId: string) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        wsRef.current.send(JSON.stringify({
            type: "req",
            id: uuid(),
            method: "chat.proposal.approve",
            params: { taskId },
        }));
    }, []);

    /**
     * Reject a proposal via RPC.
     */
    const rejectProposal = useCallback((taskId: string) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        wsRef.current.send(JSON.stringify({
            type: "req",
            id: uuid(),
            method: "chat.proposal.reject",
            params: { taskId },
        }));
    }, []);

    return { isConnected, sendCommand, sendChat, approveProposal, rejectProposal };
}
