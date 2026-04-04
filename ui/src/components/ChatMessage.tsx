"use client";

import { Bot, Loader2, User, AlertTriangle, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage as ChatMessageType } from "@/lib/store";
import { CitationBadge } from "./CitationBadge";

export function ChatMessage({ message }: { message: ChatMessageType }) {
    const isHuman = message.role === "human";
    const isQueued = message.status === "queued";
    const isThinking = message.status === "thinking";
    const isError = message.status === "error";

    return (
        <div
            className={cn(
                "flex gap-3",
                isHuman ? "flex-row-reverse" : "flex-row"
            )}
        >
            {/* Avatar */}
            <div
                className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    isHuman
                        ? "bg-claw-accent/20 text-claw-accent"
                        : "bg-mesh-info/20 text-mesh-info"
                )}
            >
                {isHuman ? <User size={16} /> : <Bot size={16} />}
            </div>

            {/* Message bubble */}
            <div
                className={cn(
                    "max-w-[75%] rounded-2xl px-4 py-3",
                    isHuman
                        ? "bg-claw-accent/12 border border-claw-accent/20"
                        : isError
                            ? "bg-mesh-alert/10 border border-mesh-alert/20"
                            : "bg-white/[0.05] border border-white/8"
                )}
            >
                {isQueued ? (
                    <div className="flex items-center gap-2 text-foreground/60">
                        <Clock3 size={14} />
                        <span className="text-sm">Queued...</span>
                    </div>
                ) : isThinking ? (
                    <div className="flex items-center gap-2 text-mesh-info">
                        <Loader2 size={14} className="animate-spin" />
                        <span className="text-sm">Thinking...</span>
                    </div>
                ) : isError ? (
                    <div className="flex items-start gap-2">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-mesh-alert" />
                        <p className="text-sm leading-6 text-foreground/80">{message.text}</p>
                    </div>
                ) : (
                    <>
                        <p className={cn(
                            "text-sm leading-6 whitespace-pre-wrap",
                            isHuman ? "text-foreground/90" : "text-foreground/80"
                        )}>
                            {message.text}
                        </p>

                        {/* Citations */}
                        {message.citations && message.citations.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                                {message.citations.map((c, i) => (
                                    <CitationBadge key={i} citation={c} />
                                ))}
                            </div>
                        )}
                    </>
                )}

                {/* Timestamp */}
                {!isQueued && !isThinking && (
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/30">
                        {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                )}
            </div>
        </div>
    );
}
