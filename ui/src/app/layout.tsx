import { Sidebar } from "@/components/Sidebar";
import "./globals.css";

export const metadata = {
  title: "ClawMesh Controller",
  description: "Advanced Sovereign Mesh Orchestration",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-background text-foreground">
        <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,120,68,0.18),transparent_28%),radial-gradient(circle_at_82%_16%,rgba(69,176,203,0.18),transparent_24%),radial-gradient(circle_at_bottom,rgba(92,127,255,0.12),transparent_36%)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:48px_48px]"
          />
          <div className="relative flex min-h-screen flex-col lg:h-screen lg:flex-row">
          <Sidebar />
          <main className="relative flex-1 overflow-auto px-4 pb-6 pt-2 sm:px-6 sm:pb-8 lg:px-8 lg:py-8">
            {children}
          </main>
          </div>
        </div>
      </body>
    </html>
  );
}
