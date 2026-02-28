"use client";

import { usePathname } from "next/navigation";
import { Activity, Map as MapIcon, Network, Settings, TerminalSquare } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
    { icon: Network, label: "Topology", href: "/" },
    { icon: MapIcon, label: "Digital Twin", href: "/twin" },
    { icon: TerminalSquare, label: "Command Center", href: "/command" },
    { icon: Activity, label: "Telemetry", href: "/telemetry" },
];

export function Sidebar({ className }: { className?: string }) {
    const pathname = usePathname();

    return (
        <aside className={cn("glass-panel m-4 flex w-20 flex-col items-center py-8 z-50", className)}>
            <div className="mb-8 font-mono text-2xl font-bold text-claw-accent tracking-tighter">
                CM
            </div>
            <nav className="flex flex-1 flex-col gap-6 w-full">
                {NAV_ITEMS.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href;

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className="group relative flex w-full flex-col items-center justify-center p-2"
                        >
                            <div
                                className={cn(
                                    "flex h-12 w-12 items-center justify-center rounded-xl transition-all duration-300",
                                    isActive
                                        ? "bg-claw-accent/20 text-claw-accent shadow-[0_0_15px_rgba(255,90,45,0.3)]"
                                        : "text-foreground/60 hover:bg-white/5 hover:text-foreground"
                                )}
                            >
                                <Icon size={24} strokeWidth={1.5} />
                            </div>
                            <span className="absolute left-full ml-4 rounded-md bg-black/80 px-2 py-1 text-xs font-medium text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none">
                                {item.label}
                            </span>
                        </Link>
                    );
                })}
            </nav>

            <div className="mt-auto">
                <div className="h-3 w-3 rounded-full bg-mesh-active animate-pulse shadow-[0_0_10px_rgba(47,191,113,0.8)]" title="Mesh Connected" />
            </div>
        </aside>
    );
}
