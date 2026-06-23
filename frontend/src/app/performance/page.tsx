"use client";

import { useEffect, useState } from "react";
import { api, type PerformanceSummary } from "@/lib/api";
import { AlertTriangle, BarChart2, RefreshCw, Target, TrendingUp } from "lucide-react";

function pct(value?: number | null) {
  if (value == null) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function num(value?: number | null, digits = 3) {
  if (value == null) return "-";
  return value.toFixed(digits);
}

export default function PerformancePage() {
  const [summary, setSummary] = useState<PerformanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
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
        <button onClick={load} className="btn-secondary flex items-center gap-2 text-sm">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Actualiser
        </button>
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
              label="Predictions evaluees"
              value={String(summary.evaluated_predictions || 0)}
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
              label="Value bets reglees"
              value={String(summary.settled_value_bets || 0)}
            />
            <Metric
              icon={<TrendingUp size={18} />}
              label="Yield flat stake"
              value={pct(summary.flat_stake_yield)}
              className={(summary.flat_stake_yield || 0) >= 0 ? "text-green-400" : "text-red-400"}
            />
          </div>

          <div className="card">
            <h2 className="font-semibold text-white mb-2">Lecture rapide</h2>
            <p className="text-sm text-gray-400">
              {summary.note}
            </p>
            <p className="text-xs text-gray-600 mt-3">
              Ces mesures ne garantissent rien. Elles servent a detecter si le modele bat vraiment le marche sur la duree.
            </p>
          </div>
        </>
      )}
    </div>
  );
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
