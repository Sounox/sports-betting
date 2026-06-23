"use client";
import { useEffect, useState } from "react";
import { api, type ValueBet } from "@/lib/api";
import { Zap, SlidersHorizontal, TrendingUp } from "lucide-react";
import { clsx } from "clsx";

export default function ValueBetsPage() {
  const [bets, setBets] = useState<ValueBet[]>([]);
  const [loading, setLoading] = useState(true);
  const [minEdge, setMinEdge] = useState(0.03);
  const [minOdds, setMinOdds] = useState(1.2);
  const [maxOdds, setMaxOdds] = useState(5.0);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getValueBets({ min_edge: minEdge, min_odds: minOdds, max_odds: maxOdds });
      setBets(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [minEdge, minOdds, maxOdds]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Zap size={24} className="text-green-400" />
          Value Bets
        </h1>
        <span className="text-gray-400 text-sm">{bets.length} opportunités</span>
      </div>

      {/* Filtres */}
      <div className="card flex flex-wrap gap-6 items-end">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Edge minimum</label>
          <select
            value={minEdge}
            onChange={(e) => setMinEdge(Number(e.target.value))}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
          >
            <option value={0.02}>2%</option>
            <option value={0.03}>3%</option>
            <option value={0.05}>5%</option>
            <option value={0.08}>8%</option>
            <option value={0.10}>10%</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Cote min</label>
          <input
            type="number" min={1.1} max={20} step={0.1} value={minOdds}
            onChange={(e) => setMinOdds(Number(e.target.value))}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white w-20"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Cote max</label>
          <input
            type="number" min={1.1} max={20} step={0.5} value={maxOdds}
            onChange={(e) => setMaxOdds(Number(e.target.value))}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white w-20"
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => <div key={i} className="card animate-pulse h-16 bg-gray-800" />)}
        </div>
      ) : bets.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">
          Aucune value bet détectée avec ces critères.
        </div>
      ) : (
        <div className="space-y-2">
          {bets.map((vb, i) => <ValueBetRow key={i} vb={vb} />)}
        </div>
      )}

      <div className="text-xs text-gray-600 text-center">
        ⚠️ Les value bets sont probabilistes. Un edge positif ne garantit pas le gain sur un seul pari.
      </div>
    </div>
  );
}

function ValueBetRow({ vb }: { vb: ValueBet }) {
  const edgePct = (vb.edge * 100).toFixed(1);
  const score = vb.recommendation_score;

  return (
    <div className="card hover:border-gray-700 transition-colors">
      <div className="flex items-center gap-4">
        {/* Score */}
        <div className={clsx(
          "w-12 h-12 rounded-xl flex items-center justify-center font-bold text-sm shrink-0",
          score >= 60 ? "bg-green-900/60 text-green-400" :
          score >= 35 ? "bg-yellow-900/60 text-yellow-400" :
          "bg-gray-800 text-gray-400"
        )}>
          {score.toFixed(0)}
        </div>

        {/* Info match */}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white text-sm truncate">{vb.match}</div>
          <div className="text-xs text-gray-400 truncate">{vb.competition}</div>
          <div className="text-xs text-gray-500 mt-0.5">{vb.label}</div>
        </div>

        {/* Cote */}
        <div className="text-center shrink-0">
          <div className="text-xl font-bold text-white">{vb.odds}</div>
          <div className="text-xs text-gray-500">{vb.bookmaker}</div>
        </div>

        {/* Probabilités */}
        <div className="text-right shrink-0 space-y-0.5">
          <div className="text-xs text-gray-400">
            Modèle : <span className="text-white font-semibold">{(vb.model_prob * 100).toFixed(0)}%</span>
          </div>
          <div className="text-xs text-gray-400">
            Marché : <span className="text-gray-300">{(vb.fair_prob * 100).toFixed(0)}%</span>
          </div>
          <div className={clsx(
            "text-xs font-bold",
            vb.edge > 0 ? "text-green-400" : "text-red-400"
          )}>
            Edge : {vb.edge > 0 ? "+" : ""}{edgePct}%
          </div>
          <div className="text-xs text-gray-400">
            EV : <span className={vb.ev > 0 ? "text-green-400" : "text-red-400"}>
              {vb.ev > 0 ? "+" : ""}{vb.ev.toFixed(3)}
            </span>
          </div>
        </div>

        {/* Mise recommandée */}
        <div className="text-right shrink-0">
          <div className="text-xs text-gray-500">Mise reco.</div>
          <div className="text-sm font-semibold text-white">
            {(vb.recommended_stake_pct * 100).toFixed(1)}% BK
          </div>
          <span className={clsx(
            "text-xs px-2 py-0.5 rounded-full font-medium",
            vb.risk_level === "prudent"    ? "bg-green-900/40 text-green-400" :
            vb.risk_level === "balanced"   ? "bg-yellow-900/40 text-yellow-400" :
            "bg-red-900/40 text-red-400"
          )}>
            {vb.risk_level}
          </span>
        </div>
      </div>
    </div>
  );
}
