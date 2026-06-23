"use client";
import Link from "next/link";
import { type Event } from "@/lib/api";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { clsx } from "clsx";
import { Zap, AlertTriangle, TrendingUp } from "lucide-react";

interface Props { event: Event; }

export function MatchCard({ event }: Props) {
  const pred = event.prediction;
  const hasValueBets = pred && (pred.value_bets?.length ?? 0) > 0;
  const topVB = pred?.value_bets?.[0];

  const probHome = pred?.prob_home ?? null;
  const probDraw = pred?.prob_draw ?? null;
  const probAway = pred?.prob_away ?? null;

  const scheduled = new Date(event.scheduled_at);

  return (
    <Link href={`/analyse/${event.id}`}>
      <div className={clsx(
        "card hover:border-gray-700 transition-colors cursor-pointer group",
        hasValueBets && "border-green-900/60"
      )}>
        <div className="flex items-center gap-4">
          {/* Date/heure */}
          <div className="text-center shrink-0 w-14">
            <div className="text-xs text-gray-500">{format(scheduled, "EEE", { locale: fr })}</div>
            <div className="text-sm font-bold text-white">{format(scheduled, "HH:mm")}</div>
          </div>

          {/* Compétition */}
          <div className="text-xs text-gray-500 w-28 shrink-0 truncate">{event.competition}</div>

          {/* Équipes */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-white truncate">{event.home_team}</span>
              {probHome && (
                <span className={clsx(
                  "text-xs font-bold shrink-0 px-2 py-0.5 rounded",
                  probHome > 0.5 ? "text-green-400 bg-green-900/40" : "text-gray-400 bg-gray-800"
                )}>
                  {(probHome * 100).toFixed(0)}%
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 mt-1">
              <span className="font-semibold text-white truncate">{event.away_team}</span>
              {probAway && (
                <span className={clsx(
                  "text-xs font-bold shrink-0 px-2 py-0.5 rounded",
                  probAway > 0.5 ? "text-green-400 bg-green-900/40" : "text-gray-400 bg-gray-800"
                )}>
                  {(probAway * 100).toFixed(0)}%
                </span>
              )}
            </div>
            {probDraw && (
              <div className="text-xs text-gray-500 mt-0.5">Nul : {(probDraw * 100).toFixed(0)}%</div>
            )}
          </div>

          {/* Value bet badge */}
          <div className="shrink-0 flex flex-col items-end gap-1">
            {hasValueBets && topVB && (
              <div className="flex items-center gap-1">
                <Zap size={12} className="text-green-400" />
                <span className="badge-value">
                  +{(topVB.edge * 100).toFixed(1)}% edge
                </span>
              </div>
            )}
            {pred?.warning_flags && pred.warning_flags.length > 0 && (
              <span className="badge-warn flex items-center gap-1">
                <AlertTriangle size={10} />
                {pred.warning_flags.length} alerte(s)
              </span>
            )}
            <ConfidenceBadge confidence={pred?.confidence} />
          </div>
        </div>

        {/* Value bet detail */}
        {hasValueBets && topVB && (
          <div className="mt-3 pt-3 border-t border-gray-800 flex items-center gap-3 text-xs">
            <span className="text-green-400 font-semibold">{topVB.label}</span>
            <span className="text-gray-400">@ {topVB.odds}</span>
            <span className="text-green-400">EV: {topVB.ev > 0 ? "+" : ""}{topVB.ev.toFixed(3)}</span>
            <span className="text-gray-500">{topVB.bookmaker}</span>
          </div>
        )}
      </div>
    </Link>
  );
}

function ConfidenceBadge({ confidence }: { confidence?: string }) {
  if (!confidence) return null;
  const map = {
    high:   { cls: "badge-value", label: "Haute conf." },
    medium: { cls: "badge-warn",  label: "Moy. conf." },
    low:    { cls: "badge-low",   label: "Faible conf." },
  } as const;
  const config = map[confidence as keyof typeof map];
  if (!config) return null;
  return <span className={config.cls}>{config.label}</span>;
}
