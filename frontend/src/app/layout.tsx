import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { AiChat } from "@/components/AiChat";

export const metadata: Metadata = {
  title: "SportsBet Analyzer",
  description: "Analyse probabiliste des paris sportifs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-gray-950 text-gray-100 min-h-screen">
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
        <AiChat />
      </body>
    </html>
  );
}
