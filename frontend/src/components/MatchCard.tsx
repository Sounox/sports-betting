"use client";
import Link from "next/link";
import { type Event } from "@/lib/api";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { clsx } from "clsx";
import { Zap, Target, BarChart2 } from "lucide-react";

interface Props { event: Event; }

export function MatchCard({ event }: Props) {
  const pred = event.prediction;
  const markets = pred?.markets;
  const hasValueBets = pred && (pred.value_bets?.length ?? 0) > 0;
  const topVB = pred?.value_bets?.[0];

  const pH = pred?.prob_home ?? null;
  const pD = pred?.prob_draw ?? null;
  const pA = pred?.prob_away ?? null;

  const ou = markets?.over_under;
  const btts = markets?.btts;
  const lambda = markets?.lambda;
  const topScore = markets?.top_scores?.[0];
  const scheduled = new Date(event.scheduled_at);

  const winnerProb = Math.max(pH ?? 0, pA ?? 0);
  const winner = (pH ?? 0) > (pA ?? 0) ? event.home_team : event.away_team;

  return (
    <Link href={`/analyse/${event.id}`}>
      <div className={clsx(
        "card hover:border-gray-600 transition-all cursor-pointer group",
        hasValueBets ? "border-green-800/70 bg-green-950/10" : ""
      )}>
        {/* Top row: heure + compétition + badge value */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="text-center">
              <div className="text-xs text-gray-500">{format(scheduled, "EEE d MMM", { locale: fr })}</div>
              <div className="text-sm font-bold text-white">{format(scheduled, "HH:mm")}</div>
            </div>
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">{event.competition}</span>
            {event.stage && <span className="text-xs text-gray-600">{event.stage}</span>}
          </div>
          {hasValueBets && topVB && (
            <div className="flex items-center gap-1.5 bg-green-900/40 border border-green-800 rounded-lg px-2 py-1">
              <Zap size={11} className="text-green-400" />
              <span className="text-xs font-bold text-green-400">VALUE +{(topVB.edge * 100).toFixed(1)}%</span>
            </div>
          )}
        </div>

        {/* Teams + probas 1X2 */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {/* Home */}
          <div className={clsx(
            "rounded-xl p-3 text-center transition-colors",
            pH && pA && pH > pA ? "bg-green-900/30 border border-green-800/50" : "bg-gray-800/60"
          )}>
            <div className="text-sm font-semibold text-white truncate">{event.home_team}</div>
            {pH && <div className="text-2xl font-black text-white mt-1">{(pH * 100).toFixed(0)}%</div>}
            <div className="text-xs text-gray-500 mt-0.5">Victoire</div>
          </div>

          {/* Draw */}
          <div className="bg-gray-800/60 rounded-xl p-3 text-center">
            <div className="text-sm font-semibold text-gray-400">Nul</div>
            {pD && <div className="text-2xl font-black text-gray-300 mt-1">{(pD * 100).toFixed(0)}%</div>}
            {topScore && <div className="text-xs text-gray-600 mt-0.5">{topScore.score}</div>}
          </div>

          {/* Away */}
          <div className={clsx(
            "rounded-xl p-3 text-center transition-colors",
            pA && pH && pA > pH ? "bg-blue-900/30 border border-blue-800/50" : "bg-gray-800/60"
          )}>
            <div className="text-sm font-semibold text-white truncate">{event.away_team}</div>
            {pA && <div className="text-2xl font-black text-white mt-1">{(pA * 100).toFixed(0)}%</div>}
            <div className="text-xs text-gray-500 mt-0.5">Victoire</div>
          </div>
        </div>

        {/* Stats secondaires */}
        {pred && (
          <div className="grid grid-cols-3 gap-2 text-xs">
            {/* Buts attendus */}
            {lambda && (
              <div className="bg-gray-800/40 rounded-lg px-2 py-1.5 text-center">
                <div className="text-gray-500 mb-0.5">Buts attendus</div>
                <div className="font-bold text-white">
                  {(lambda.home + lambda.away).toFixed(1)}
                  <span className="text-gray-500 font-normal"> ({lambda.home.toFixed(1)}–{lambda.away.toFixed(1)})</span>
                </div>
              </div>
            )}

            {/* Over 2.5 */}
            {ou?.over_2_5 != null && (
              <div className="bg-gray-800/40 rounded-lg px-2 py-1.5 text-center">
                <div className="text-gray-500 mb-0.5">Over 2.5</div>
                <div className={clsx("font-bold", ou.over_2_5 > 0.5 ? "text-orange-400" : "text-gray-300")}>
                  {(ou.over_2_5 * 100).toFixed(0)}%
                </div>
              </div>
            )}

            {/* BTTS */}
            {btts?.yes != null && (
              <div className="bg-gray-800/40 rounded-lg px-2 py-1.5 text-center">
                <div className="text-gray-500 mb-0.5">Les 2 marquent</div>
                <div className={clsx("font-bold", btts.yes > 0.5 ? "text-purple-400" : "text-gray-300")}>
                  {(btts.yes * 100).toFixed(0)}%
                </div>
              </div>
            )}

            {/* Fallback si pas de Dixon-Coles */}
            {!lambda && !ou && (
              <div className="col-span-3 text-center text-gray-600 py-1">
                Données stats limitées — modèle Elo uniquement
              </div>
            )}
          </div>
        )}

        {/* Value bet détail */}
        {hasValueBets && topVB && (
          <div className="mt-3 pt-3 border-t border-green-900/40 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Target size={11} className="text-green-400" />
              <span className="text-green-300 font-semibold">{topVB.label}</span>
              <span className="text-gray-400">@ <span className="text-white font-bold">{topVB.odds}</span></span>
              <span className="text-gray-500">{topVB.bookmaker}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-400">
              <span>EV <span className="text-green-400 font-bold">{topVB.ev > 0 ? "+" : ""}{(topVB.ev * 100).toFixed(1)}%</span></span>
              <span>Kelly <span className="text-yellow-400 font-bold">{(topVB.kelly_stake_pct * 100).toFixed(1)}%</span></span>
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
