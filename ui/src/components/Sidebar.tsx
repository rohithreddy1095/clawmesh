"use client";

import { usePathname } from "next/navigation";
import { Activity, Map as MapIcon, Network, TerminalSquare, TreePine } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
    { icon: Network, label: "Topology", href: "/" },
    { icon: TreePine, label: "3D Farm Twin", href: "/twin3d" },
    { icon: MapIcon, label: "Digital Twin", href: "/twin" },
    { icon: TerminalSquare, label: "Command Center", href: "/command" },
    { icon: Activity, label: "Telemetry", href: "/telemetry" },
];

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <aside className={cn("relative z-50 pt-4 lg:w-[280px] lg:shrink-0 lg:pt-8", className)}>
      <div className="glass-panel flex flex-col gap-4 px-4 py-4 lg:ml-0 lg:h-[calc(100vh-4rem)] lg:rounded-[2rem] lg:px-5 lg:py-5">
        <div className="flex items-center justify-between gap-3 border-b border-white/6 pb-4 lg:flex-col lg:items-start lg:gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl border border-claw-accent/30 bg-claw-accent/12 text-lg font-semibold text-claw-accent shadow-[0_0_28px_rgba(255,120,68,0.2)]">
              CM
            </div>
            <div className="lg:block">
              <p className="text-xs font-mono uppercase tracking-[0.24em] text-foreground/45">
                Mesh Console
              </p>
              <p className="text-base font-semibold tracking-tight text-white">
                ClawMesh
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-mesh-active/20 bg-mesh-active/8 px-3 py-1.5 lg:w-full lg:justify-center">
            <span className="h-2.5 w-2.5 rounded-full bg-mesh-active shadow-[0_0_14px_rgba(90,216,127,0.7)]" />
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-mesh-active">
              Mesh Online
            </span>
          </div>
        </div>

        <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:flex-1 lg:flex-col lg:gap-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex min-h-16 items-center gap-3 rounded-2xl border px-3 py-3 transition-all duration-300 lg:min-h-0 lg:px-4",
                  isActive
                    ? "border-claw-accent/30 bg-claw-accent/12 text-white shadow-[0_12px_28px_rgba(255,120,68,0.16)]"
                    : "border-white/5 bg-white/[0.025] text-foreground/70 hover:border-white/10 hover:bg-white/[0.045] hover:text-white"
                )}
              >
                <div
                  className={cn(
                    "grid h-10 w-10 shrink-0 place-items-center rounded-2xl border transition-colors duration-300",
                    isActive
                      ? "border-claw-accent/35 bg-claw-accent/18 text-claw-accent"
                      : "border-white/8 bg-black/20 text-foreground/60 group-hover:text-foreground"
                  )}
                >
                  <Icon size={18} strokeWidth={1.8} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium tracking-tight">{item.label}</p>
                  <p className="mt-0.5 hidden font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/40 lg:block">
                    {isActive ? "Active Surface" : "Navigate"}
                  </p>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="hidden rounded-2xl border border-white/6 bg-black/20 px-4 py-4 lg:block">
          <p className="section-label">Current Mode</p>
          <p className="mt-2 text-lg font-semibold tracking-tight text-white">Operator View</p>
          <p className="mt-2 text-sm leading-6 text-foreground/60">
            Watch topology, dispatch intent, and verify critical actions from one surface.
          </p>
        </div>
      </div>
    </aside>
  );
}
