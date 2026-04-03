"use client";

import { useEffect, useRef, useCallback } from "react";
import { useMeshStore, type ContextFrame, type MeshPeer, type Proposal } from "./store";

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

    const {
        isConnected,
        setConnected,
        setPeers,
        addFrame,
        addChatMessage,
        addProposal,
        updateProposalStatus,
    } = useMeshStore();

    useEffect(() => {
        function connect() {
            if (wsRef.current?.readyState === WebSocket.OPEN) return;

            const ws = new WebSocket(WS_URL);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log("[useMesh] Connected to local mesh node");
                setConnected(true);

                // Subscribe to chat events
                ws.send(JSON.stringify({ type: "req", id: uuid(), method: "chat.subscribe" }));

                // Ask for currently connected peers on open
                ws.send(JSON.stringify({ type: "req", id: uuid(), method: "mesh.peers" }));
            };

            ws.onclose = () => {
                console.log("[useMesh] Disconnected from mesh node");
                setConnected(false);
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
                                status: status as "complete" | "thinking" | "error",
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

                    // Handle generic responses (like our initial peers list request)
                    if (msg.type === "res" && msg.ok && msg.payload?.peers) {
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
            if (wsRef.current) wsRef.current.close();
        };
    }, [setConnected, setPeers, addFrame, addChatMessage, addProposal, updateProposalStatus]);

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
