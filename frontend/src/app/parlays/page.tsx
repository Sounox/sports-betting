"use client";
import { useState } from "react";
import { api, type ParlayResponse } from "@/lib/api";
import { Layers, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { clsx } from "clsx";

const RISK_LEVELS = [
  { value: "prudent",    label: "Prudent",    desc: "2-3 sélections, edge solide", color: "green" },
  { value: "balanced",   label: "Équilibré",  desc: "2-5 sélections, risque moyen", color: "yellow" },
  { value: "aggressive", label: "Agressif",   desc: "3-8 sélections, haute variance", color: "red" },
] as const;

export default function ParlaysPage() {
  const [targetOdds, setTargetOdds] = useState(3.0);
  const [stake, setStake] = useState(10);
  const [bankroll, setBankroll] = useState(1000);
  const [riskLevel, setRiskLevel] = useState<"prudent" | "balanced" | "aggressive">("balanced");
  const [maxLegs, setMaxLegs] = useState(4);
  const [result, setResult] = useState<ParlayResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await api.generateParlay({ target_odds: targetOdds, stake, bankroll, risk_level: riskLevel, max_legs: maxLegs });
      setResult(res);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-white flex items-center gap-2">
        <Layers size={24} className="text-green-400" />
        Générateur de Combinés
      </h1>

      {/* Formulaire */}
      <div className="card space-y-5">
        <h2 className="font-semibold text-gray-300">Paramètres</h2>

        {/* Niveau de risque */}
        <div>
          <label className="block text-xs text-gray-400 mb-2">Niveau de risque</label>
          <div className="grid grid-cols-3 gap-2">
            {RISK_LEVELS.map((r) => (
              <button
                key={r.value}
                onClick={() => setRiskLevel(r.value)}
                className={clsx(
                  "p-3 rounded-xl border text-left transition-colors",
                  riskLevel === r.value
                    ? r.color === "green" ? "bg-green-900/40 border-green-600 text-green-400"
                      : r.color === "yellow" ? "bg-yellow-900/40 border-yellow-600 text-yellow-400"
                      : "bg-red-900/40 border-red-600 text-red-400"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
                )}
              >
                <div className="font-semibold text-sm">{r.label}</div>
                <div className="text-xs mt-0.5 opacity-75">{r.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Paramètres numériques */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Cote cible</label>
            <input type="number" min={1.5} max={50} step={0.5} value={targetOdds}
              onChange={(e) => setTargetOdds(Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Mise (€)</label>
            <input type="number" min={1} max={1000} value={stake}
              onChange={(e) => setStake(Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Bankroll (€)</label>
            <input type="number" min={10} value={bankroll}
              onChange={(e) => setBankroll(Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Sélections max</label>
            <input type="number" min={2} max={8} value={maxLegs}
              onChange={(e) => setMaxLegs(Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>
        </div>

        <button onClick={generate} disabled={loading} className="btn-primary w-full">
          {loading ? "Génération en cours..." : "Générer le combiné"}
        </button>
      </div>

      {/* Résultat */}
      {result && (
        result.success && result.parlay ? (
          <ParlaySuccess parlay={result.parlay} />
        ) : (
          <div className="card border-red-800 bg-red-900/20">
            <div className="flex items-start gap-3">
              <XCircle size={20} className="text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-400">Aucun combiné recommandé</p>
                <p className="text-sm text-red-400/80 mt-1">{result.error}</p>
                <p className="text-xs text-gray-500 mt-2">{result.message}</p>
              </div>
            </div>
          </div>
        )
      )}

      <p className="text-xs text-gray-600 text-center">
        ⚠️ Un combiné multiplie les risques. La probabilité de succès diminue avec chaque sélection ajoutée.
      </p>
    </div>
  );
}

function ParlaySuccess({ parlay }: { parlay: NonNullable<ParlayResponse["parlay"]> }) {
  const probPct = (parlay.theoretical_probability * 100).toFixed(1);

  return (
    <div className="card border-green-800 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle size={20} className="text-green-400" />
          <span className="font-bold text-white">Combiné recommandé</span>
        </div>
        <span className={clsx(
          "text-xs px-2 py-1 rounded-full font-medium",
          parlay.risk_level === "prudent" ? "bg-green-900/40 text-green-400" :
          parlay.risk_level === "balanced" ? "bg-yellow-900/40 text-yellow-400" :
          "bg-red-900/40 text-red-400"
        )}>
          {parlay.risk_level}
        </span>
      </div>

      {/* Sélections */}
      <div className="space-y-2">
        {parlay.legs.map((leg, i) => (
          <div key={i} className="bg-gray-800 rounded-lg p-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-white">{leg.match}</div>
              <div className="text-xs text-gray-400">{leg.selection} · {leg.market}</div>
              <div className="text-xs text-green-400">Edge : +{(leg.edge * 100).toFixed(1)}%</div>
            </div>
            <div className="text-right">
              <div className="text-xl font-bold text-white">{leg.odds}</div>
              <div className="text-xs text-gray-500">{leg.bookmaker}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Résumé */}
      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-800">
        <Stat label="Cote totale" value={parlay.total_odds.toFixed(2)} highlight />
        <Stat label="Prob. théorique" value={`${probPct}%`} />
        <Stat label="Mise recommandée" value={`${parlay.recommended_stake} €`} highlight />
        <Stat label="Gain potentiel" value={`${parlay.potential_return} €`} />
        <Stat label="EV" value={parlay.expected_value > 0 ? `+${parlay.expected_value.toFixed(3)}` : parlay.expected_value.toFixed(3)}
          className={parlay.expected_value > 0 ? "text-green-400" : "text-red-400"} />
      </div>

      {/* Avertissements */}
      {parlay.warnings.length > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-lg p-3 space-y-1">
          {parlay.warnings.map((w, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-yellow-400">
              <AlertTriangle size={12} />
              {w}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-600">
        ⚠️ Cette recommandation est probabiliste. Aucun gain n'est garanti.
      </p>
    </div>
  );
}

function Stat({ label, value, highlight = false, className = "" }: {
  label: string; value: string; highlight?: boolean; className?: string;
}) {
  return (
    <div className="bg-gray-800 rounded-lg p-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={clsx("text-lg font-bold mt-0.5", highlight ? "text-white" : "text-gray-300", className)}>
        {value}
      </div>
    </div>
  );
}
