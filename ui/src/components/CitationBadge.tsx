"use client";

import { Activity, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

type Citation = {
    metric: string;
    value: unknown;
    zone?: string;
    timestamp: number;
};

export function CitationBadge({ citation }: { citation: Citation }) {
    const [expanded, setExpanded] = useState(false);

    return (
        <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="inline-flex flex-col items-start rounded-xl border border-mesh-info/20 bg-mesh-info/8 px-2.5 py-1.5 text-left transition-colors hover:bg-mesh-info/14"
        >
            <div className="flex items-center gap-1.5">
                <Activity size={11} className="text-mesh-info" />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-mesh-info">
                    {citation.metric}
                    {citation.zone ? ` · ${citation.zone}` : ""}
                </span>
                {expanded ? (
                    <ChevronUp size={10} className="text-mesh-info/60" />
                ) : (
                    <ChevronDown size={10} className="text-mesh-info/60" />
                )}
            </div>
            {expanded && (
                <div className="mt-1 font-mono text-[10px] text-foreground/50">
                    Value: {String(citation.value)} · {new Date(citation.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </div>
            )}
        </button>
    );
}
