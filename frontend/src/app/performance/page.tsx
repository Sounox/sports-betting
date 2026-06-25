"use client";

import { useEffect, useState } from "react";
import { api, type PerformanceSummary } from "@/lib/api";
import { AlertTriangle, BarChart2, RefreshCw, Target, TrendingUp } from "lucide-react";

function pct(value?: number | null) {
  if (value == null) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function signedPct(value?: number | null) {
  if (value == null) return "-";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function num(value?: number | null, digits = 3) {
  if (value == null) return "-";
  return value.toFixed(digits);
}

export default function PerformancePage() {
  const [summary, setSummary] = useState<PerformanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await api.getPerformanceSummary());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const settle = async () => {
    setSettling(true);
    setError(null);
    try {
      await api.settlePerformance();
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSettling(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BarChart2 size={24} className="text-green-400" />
            Performance modele
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Mesure la fiabilite reelle: hit rate, Brier Score, log loss, yield et profit flat stake.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={settle} disabled={settling} className="btn-primary flex items-center gap-2 text-sm">
            <RefreshCw size={14} className={settling ? "animate-spin" : ""} />
            Mettre a jour
          </button>
          <button onClick={load} className="btn-secondary flex items-center gap-2 text-sm">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Actualiser
          </button>
        </div>
      </div>

      {error && (
        <div className="card border-red-800 bg-red-900/20 text-red-400 text-sm">
          Erreur: {error}
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card animate-pulse h-28 bg-gray-800" />
          ))}
        </div>
      )}

      {!loading && summary && !summary.enabled && (
        <div className="card border-yellow-800 bg-yellow-950/20">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-yellow-300">Historique non active</p>
              <p className="text-sm text-yellow-200/80 mt-1">
                {summary.message || "Il faut connecter une base Cloudflare D1 pour stocker les snapshots."}
              </p>
              <p className="text-xs text-gray-500 mt-2">
                Les analyses restent disponibles, mais le backtesting durable commence seulement apres activation D1.
              </p>
            </div>
          </div>
        </div>
      )}

      {!loading && summary?.enabled && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Metric
              icon={<Target size={18} />}
              label="Matchs evalues"
              value={String(summary.events_evaluated || summary.evaluated_predictions || 0)}
            />
            <Metric
              icon={<TrendingUp size={18} />}
              label="Hit rate 1N2"
              value={pct(summary.hit_rate)}
            />
            <Metric
              icon={<BarChart2 size={18} />}
              label="Brier Score"
              value={num(summary.brier_score)}
              hint="Plus bas = mieux calibre"
            />
            <Metric
              icon={<BarChart2 size={18} />}
              label="Log Loss"
              value={num(summary.log_loss)}
              hint="Punit les grosses erreurs"
            />
            <Metric
              icon={<TrendingUp size={18} />}
              label="Marches modele regles"
              value={String(summary.prediction_markets_settled || 0)}
            />
            <Metric
              icon={<TrendingUp size={18} />}
              label="Value bets reglees"
              value={String(summary.settled_value_bets || 0)}
            />
            <Metric
              icon={<TrendingUp size={18} />}
              label="Yield flat stake"
              value={pct(summary.flat_stake_yield)}
              className={(summary.flat_stake_yield || 0) >= 0 ? "text-green-400" : "text-red-400"}
            />
            <Metric
              icon={<TrendingUp size={18} />}
              label="CLV moyenne"
              value={signedPct(summary.avg_clv)}
              hint={`${summary.clv_count || 0} value bets avec cote de cloture`}
              className={(summary.avg_clv || 0) >= 0 ? "text-green-400" : "text-red-400"}
            />
            <Metric
              icon={<Target size={18} />}
              label="CLV positive"
              value={pct(summary.positive_clv_rate)}
              hint="Part des paris pris avant que la cote baisse"
            />
            <Metric
              icon={<BarChart2 size={18} />}
              label="Cote cloture moy."
              value={num(summary.avg_closing_odds, 2)}
              hint="Derniere cote observee avant match"
            />
          </div>

          <div className="card">
            <h2 className="font-semibold text-white mb-2">Lecture rapide</h2>
            <p className="text-sm text-gray-400">
              {summary.note}
            </p>
            {summary.latest_settlement && (
              <p className="text-xs text-gray-500 mt-2">
                Dernier settlement: {summary.latest_settlement.status} - {new Date(summary.latest_settlement.started_at).toLocaleString("fr-FR")}
              </p>
            )}
            <p className="text-xs text-gray-600 mt-3">
              Ces mesures ne garantissent rien. Elles servent a detecter si le modele bat vraiment le marche sur la duree.
            </p>
          </div>

          <div className="card overflow-x-auto">
            <h2 className="font-semibold text-white mb-3">Performance par marche</h2>
            {(summary.market_breakdown || []).length === 0 ? (
              <p className="text-sm text-gray-500">
                Aucun marche encore evalue. Lance une mise a jour apres des matchs termines avec snapshots pre-match.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3">Marche</th>
                    <th className="py-2 pr-3 text-right">Regles</th>
                    <th className="py-2 pr-3 text-right">Winrate</th>
                    <th className="py-2 pr-3 text-right">Profit flat</th>
                    <th className="py-2 pr-3 text-right">Yield</th>
                    <th className="py-2 text-right">Prob. moy.</th>
                    <th className="py-2 text-right">CLV</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary.market_breakdown || []).map((row) => (
                    <tr key={`${row.source}-${row.market}`} className="border-b border-gray-900 text-gray-300">
                      <td className="py-2 pr-3">
                        {row.source === "value_bet" ? "Value bet" : "Modele"}
                      </td>
                      <td className="py-2 pr-3">{labelMarket(row.market)}</td>
                      <td className="py-2 pr-3 text-right">{row.settled}</td>
                      <td className="py-2 pr-3 text-right">{pct(row.hit_rate)}</td>
                      <td className={`py-2 pr-3 text-right ${row.flat_profit >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {row.flat_profit >= 0 ? "+" : ""}{row.flat_profit.toFixed(2)}
                      </td>
                      <td className={`py-2 pr-3 text-right ${(row.flat_yield || 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {pct(row.flat_yield)}
                      </td>
                      <td className="py-2 text-right">{pct(row.avg_model_prob)}</td>
                      <td className={`py-2 text-right ${(row.avg_clv || 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {row.clv_count ? signedPct(row.avg_clv) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card overflow-x-auto">
            <h2 className="font-semibold text-white mb-2">Calibration des probabilites</h2>
            <p className="text-xs text-gray-500 mb-3">
              Compare les probabilites annoncees avec le taux de reussite observe. Une erreur proche de 0 indique un modele plus honnete.
            </p>
            {(summary.calibration || []).length === 0 ? (
              <p className="text-sm text-gray-500">
                Pas encore assez de predictions settlees pour afficher une calibration.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                    <th className="py-2 pr-3">Tranche</th>
                    <th className="py-2 pr-3 text-right">Volume</th>
                    <th className="py-2 pr-3 text-right">Proba moy.</th>
                    <th className="py-2 pr-3 text-right">Reussite reelle</th>
                    <th className="py-2 text-right">Ecart</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary.calibration || []).map((bucket) => (
                    <tr key={bucket.bucket} className="border-b border-gray-900 text-gray-300">
                      <td className="py-2 pr-3">{bucket.label}</td>
                      <td className="py-2 pr-3 text-right">{bucket.count}</td>
                      <td className="py-2 pr-3 text-right">{pct(bucket.avg_probability)}</td>
                      <td className="py-2 pr-3 text-right">{pct(bucket.actual_rate)}</td>
                      <td className={`py-2 text-right ${Math.abs(bucket.calibration_error) <= 0.05 ? "text-green-400" : "text-yellow-400"}`}>
                        {signedPct(bucket.calibration_error)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function labelMarket(market: string) {
  const labels: Record<string, string> = {
    h2h: "1N2",
    totals: "Over/Under",
    btts: "BTTS",
    spreads: "Handicap",
    exact_score: "Score exact",
  };
  return labels[market] || market;
}

function Metric({
  icon,
  label,
  value,
  hint,
  className = "text-white",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 text-green-400 mb-3">{icon}</div>
      <div className={`text-2xl font-bold ${className}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
      {hint && <div className="text-xs text-gray-600 mt-2">{hint}</div>}
    </div>
  );
}
