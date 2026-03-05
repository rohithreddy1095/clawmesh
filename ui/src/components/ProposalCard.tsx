"use client";

import { CheckCircle2, ShieldAlert, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Proposal } from "@/lib/store";

type ProposalCardProps = {
    proposal: Proposal;
    onApprove: (taskId: string) => void;
    onReject: (taskId: string) => void;
};

export function ProposalCard({ proposal, onApprove, onReject }: ProposalCardProps) {
    const isPending = proposal.status === "proposed" || proposal.status === "awaiting_approval";
    const isApproved = proposal.status === "approved" || proposal.status === "completed" || proposal.status === "executing";
    const isRejected = proposal.status === "rejected";

    return (
        <div
            className={cn(
                "rounded-2xl border p-4 transition-all",
                isPending && "border-mesh-warn/25 bg-mesh-warn/8 shadow-[0_0_20px_rgba(255,191,92,0.08)]",
                isApproved && "border-mesh-active/20 bg-mesh-active/8",
                isRejected && "border-white/6 bg-white/[0.03] opacity-70",
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        {isPending && <ShieldAlert size={16} className="text-mesh-warn" />}
                        {isApproved && <CheckCircle2 size={16} className="text-mesh-active" />}
                        {isRejected && <XCircle size={16} className="text-foreground/40" />}
                        <span
                            className={cn(
                                "font-mono text-[11px] uppercase tracking-[0.18em]",
                                isPending && "text-mesh-warn",
                                isApproved && "text-mesh-active",
                                isRejected && "text-foreground/40",
                            )}
                        >
                            {isPending ? "Needs Approval" : proposal.status}
                        </span>
                        <span className="font-mono text-[10px] text-foreground/30">
                            [{proposal.approvalLevel}]
                        </span>
                    </div>

                    <p className={cn(
                        "mt-2 text-sm font-medium",
                        isRejected ? "text-foreground/50 line-through" : "text-white"
                    )}>
                        {proposal.summary}
                    </p>

                    {proposal.reasoning && isPending && (
                        <p className="mt-1.5 text-xs leading-5 text-foreground/55">
                            {proposal.reasoning}
                        </p>
                    )}

                    <div className="mt-2 font-mono text-[10px] leading-5 text-foreground/40">
                        {">>"} Target: {proposal.targetRef}
                        <br />
                        {">>"} Op: {proposal.operation}
                        {proposal.operationParams && Object.keys(proposal.operationParams).length > 0 && (
                            <>
                                <br />
                                {">>"} Params: {JSON.stringify(proposal.operationParams)}
                            </>
                        )}
                    </div>
                </div>

                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/30">
                    {new Date(proposal.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
            </div>

            {isPending && (
                <div className="mt-3 flex flex-wrap gap-2">
                    <button
                        onClick={() => onApprove(proposal.taskId)}
                        className="rounded-xl bg-mesh-active px-3.5 py-2 text-xs font-semibold text-black transition-colors hover:bg-mesh-active/80"
                    >
                        Approve
                    </button>
                    <button
                        onClick={() => onReject(proposal.taskId)}
                        className="rounded-xl border border-white/8 bg-white/[0.06] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-white/[0.12]"
                    >
                        Reject
                    </button>
                </div>
            )}

            {isApproved && proposal.resolvedBy && (
                <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-mesh-active">
                    {">>"} Approved by {proposal.resolvedBy}
                </div>
            )}

            {isRejected && (
                <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/35">
                    {">>"} Rejected by {proposal.resolvedBy || "operator"}
                </div>
            )}
        </div>
    );
}
