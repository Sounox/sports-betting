"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar, Zap, Layers, Search, BarChart2, Sparkles,
  TrendingUp, DollarSign, Settings, AlertTriangle,
} from "lucide-react";
import { clsx } from "clsx";

const NAV = [
  { href: "/",           label: "Matchs du jour",   icon: Calendar },
  { href: "/recommendations", label: "Recommandations", icon: Sparkles },
  { href: "/value-bets", label: "Value Bets",        icon: Zap },
  { href: "/parlays",    label: "Combinés",           icon: Layers },
  { href: "/analyse",    label: "Analyse match",     icon: Search },
  { href: "/historique", label: "Historique",         icon: TrendingUp },
  { href: "/performance",label: "Performance",        icon: BarChart2 },
  { href: "/bankroll",   label: "Bankroll",           icon: DollarSign },
  { href: "/config",     label: "Configuration",      icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
      {/* Logo */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center font-bold text-sm">S</div>
          <div>
            <div className="font-bold text-sm text-white">SportsBet</div>
            <div className="text-xs text-gray-500">Analyzer v1.0</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={clsx(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
              pathname === href
                ? "bg-green-600/20 text-green-400 font-medium"
                : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            )}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
      </nav>

      {/* Disclaimer */}
      <div className="p-3 border-t border-gray-800">
        <div className="flex gap-2 bg-yellow-900/30 border border-yellow-800/50 rounded-lg p-2">
          <AlertTriangle size={14} className="text-yellow-500 mt-0.5 shrink-0" />
          <p className="text-xs text-yellow-600 leading-tight">
            Outil probabiliste uniquement. Aucun gain garanti.
          </p>
        </div>
      </div>
    </aside>
  );
}
