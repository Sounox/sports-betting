import type { Metadata } from "next";
import "./globals.css";
import { MobileDock, Sidebar } from "@/components/Sidebar";
import { AiChat } from "@/components/AiChat";

export const metadata: Metadata = {
  title: "SportsBet Analyzer",
  description: "Analyse probabiliste des paris sportifs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.08),transparent_28%),#030712] text-gray-100">
        <div className="flex h-dvh overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto px-3 pb-28 pt-4 sm:px-5 sm:pt-5 lg:p-6">
            {children}
          </main>
        </div>
        <MobileDock />
        <AiChat />
      </body>
    </html>
  );
}
