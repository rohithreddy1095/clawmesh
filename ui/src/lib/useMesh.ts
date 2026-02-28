"use client";

import { useEffect, useRef } from "react";
import { useMeshStore, ContextFrame, MeshPeer } from "./store";

const WS_URL = "ws://localhost:18789"; // Replace with your mesh node's local address

export function useMesh() {
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);

    const { isConnected, setConnected, setPeers, addFrame } = useMeshStore();

    useEffect(() => {
        function connect() {
            if (wsRef.current?.readyState === WebSocket.OPEN) return;

            const ws = new WebSocket(WS_URL);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log("[useMesh] Connected to local mesh node");
                setConnected(true);

                // Ask for currently connected peers on open
                ws.send(JSON.stringify({ type: "req", id: crypto.randomUUID(), method: "clawmesh.peers.list" }));
            };

            ws.onclose = () => {
                console.log("[useMesh] Disconnected from mesh node");
                setConnected(false);
                // Try to reconnect
                reconnectTimeout.current = setTimeout(connect, 3000);
            };

            ws.onerror = () => {
                // Silently handle connection errors (likely just means the local node is offline)
                // We don't want to spam the console or trigger Next.js error overlays.
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);

                    // Handle incoming context gossip events
                    if (msg.type === "event" && msg.event === "context.frame") {
                        const frame = msg.payload as ContextFrame;
                        addFrame(frame);
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
    }, [setConnected, setPeers, addFrame]);

    // Command to send mock actuator forwards
    const sendCommand = (peerDeviceId: string, targetRef: string, operation: string, note?: string) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        wsRef.current.send(JSON.stringify({
            type: "req",
            id: crypto.randomUUID(),
            method: "clawmesh.forward",
            params: {
                peerDeviceId,
                channel: "clawmesh",
                targetRef,
                operation,
                note
            }
        }));
    };

    return { isConnected, sendCommand };
}
