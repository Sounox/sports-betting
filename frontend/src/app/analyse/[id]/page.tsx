"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, type Event } from "@/lib/api";
import { AlertTriangle, Loader2, RefreshCw, TrendingUp, Calculator, Target, BarChart2, ChevronDown, ChevronUp } from "lucide-react";
import { clsx } from "clsx";

export default function AnalysePage() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [predicting, setPredicting] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setEvent(await api.getEvent(Number(id))); }
    finally { setLoading(false); }
  };

  const runPrediction = async () => {
    setPredicting(true);
    try { await api.predictEvent(Number(id)); await load(); }
    finally { setPredicting(false); }
  };

  useEffect(() => { load(); }, [id]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-gray-500" size={32} /></div>;
  if (!event) return <div className="card text-gray-500">Événement non trouvé</div>;

  const pred = event.prediction;
  const markets = pred?.markets;
  const ou = markets?.over_under;
  const btts = markets?.btts;
  const lambda = markets?.lambda;

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header match */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">{event.competition}</span>
            {event.stage && <span className="text-xs text-gray-600">{event.stage}</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className={clsx("text-xs px-2 py-0.5 rounded-full", statusColor(event.status))}>{event.status}</span>
            <button onClick={runPrediction} disabled={predicting} className="btn-secondary flex items-center gap-2 text-sm">
              {predicting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {pred ? "Recalculer" : "Calculer"}
            </button>
          </div>
        </div>

        {/* Score central */}
        <div className="grid grid-cols-3 gap-4 items-center">
          <div className={clsx("rounded-2xl p-4 text-center", pred?.prob_home && pred.prob_home > (pred?.prob_away ?? 0) ? "bg-green-900/30 border border-green-800/50" : "bg-gray-800/50")}>
            <div className="text-xl font-bold text-white">{event.home_team}</div>
            {pred && <div className="text-4xl font-black text-white mt-2">{(pred.prob_home! * 100).toFixed(0)}%</div>}
            <div className="text-xs text-gray-500 mt-1">Victoire domicile</div>
          </div>
          <div className="text-center">
            <div className="text-gray-400 text-sm font-semibold">VS</div>
            {pred && <div className="text-2xl font-black text-gray-300 mt-1">{(pred.prob_draw! * 100).toFixed(0)}%</div>}
            <div className="text-xs text-gray-500">Match nul</div>
            {lambda && (
              <div className="mt-3 bg-gray-800 rounded-xl px-3 py-2">
                <div className="text-xs text-gray-500">Buts attendus</div>
                <div className="text-lg font-bold text-orange-400">{(lambda.home + lambda.away).toFixed(1)}</div>
                <div className="text-xs text-gray-500">{lambda.home.toFixed(1)} – {lambda.away.toFixed(1)}</div>
              </div>
            )}
          </div>
          <div className={clsx("rounded-2xl p-4 text-center", pred?.prob_away && pred.prob_away > (pred?.prob_home ?? 0) ? "bg-blue-900/30 border border-blue-800/50" : "bg-gray-800/50")}>
            <div className="text-xl font-bold text-white">{event.away_team}</div>
            {pred && <div className="text-4xl font-black text-white mt-2">{(pred.prob_away! * 100).toFixed(0)}%</div>}
            <div className="text-xs text-gray-500 mt-1">Victoire extérieur</div>
          </div>
        </div>

        {/* Badges */}
        {pred && (
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <ConfBadge c={pred.confidence} />
            <QualBadge q={pred.data_quality} />
            {pred.warning_flags?.map((w, i) => (
              <span key={i} className="flex items-center gap-1 text-xs text-yellow-400 bg-yellow-900/20 px-2 py-0.5 rounded-full">
                <AlertTriangle size={10} />{w.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Stats marchés */}
      {markets && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Over / Under */}
          {ou && (
            <div className="card">
              <h3 className="font-semibold text-gray-300 mb-3 text-sm flex items-center gap-2"><BarChart2 size={14} />Over / Under</h3>
              <div className="space-y-2">
                {[
                  { label: "Over 0.5", v: ou.over_0_5 },
                  { label: "Over 1.5", v: ou.over_1_5 },
                  { label: "Over 2.5", v: ou.over_2_5 },
                  { label: "Over 3.5", v: ou.over_3_5 },
                  { label: "Under 2.5", v: ou.under_2_5 },
                ].filter(x => x.v != null).map(({ label, v }) => (
                  <div key={label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-400">{label}</span>
                      <span className="font-bold text-white">{(v * 100).toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className={clsx("h-full rounded-full", v > 0.5 ? "bg-orange-500" : "bg-gray-600")} style={{ width: `${v * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* BTTS + mi-temps */}
          <div className="card space-y-4">
            {btts && (
              <div>
                <h3 className="font-semibold text-gray-300 mb-3 text-sm">Les 2 équipes marquent</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className={clsx("rounded-xl p-3 text-center", btts.yes > 0.5 ? "bg-purple-900/40 border border-purple-800/50" : "bg-gray-800")}>
                    <div className="text-xs text-gray-400">Oui</div>
                    <div className="text-xl font-black text-white">{(btts.yes * 100).toFixed(0)}%</div>
                  </div>
                  <div className="bg-gray-800 rounded-xl p-3 text-center">
                    <div className="text-xs text-gray-400">Non</div>
                    <div className="text-xl font-black text-white">{(btts.no * 100).toFixed(0)}%</div>
                  </div>
                </div>
              </div>
            )}
            {markets["half_time"] && (
              <div>
                <h3 className="font-semibold text-gray-300 mb-2 text-sm">Mi-temps</h3>
                <div className="space-y-1">
                  {[
                    { label: event.home_team, v: markets["half_time"].home },
                    { label: "Nul", v: markets["half_time"].draw },
                    { label: event.away_team, v: markets["half_time"].away },
                  ].map(({ label, v }) => (
                    <div key={label} className="flex justify-between text-xs">
                      <span className="text-gray-400 truncate">{label}</span>
                      <span className="font-bold text-white">{(v * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Scores probables */}
          {markets.top_scores && (
            <div className="card">
              <h3 className="font-semibold text-gray-300 mb-3 text-sm">Scores les plus probables</h3>
              <div className="space-y-1.5">
                {markets.top_scores.slice(0, 8).map((s: any, i: number) => (
                  <div key={i} className={clsx("flex items-center justify-between rounded-lg px-3 py-1.5", i === 0 ? "bg-green-900/40 border border-green-800/50" : "bg-gray-800/60")}>
                    <span className={clsx("font-bold", i === 0 ? "text-green-400" : "text-white")}>{s.score}</span>
                    <span className="text-xs text-gray-400">{(s.prob * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Calculateur de paris */}
      {pred && <BetCalculator event={event} pred={pred} />}

      {/* Value bets */}
      {pred?.value_bets && pred.value_bets.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-green-400 mb-3 flex items-center gap-2">
            <TrendingUp size={16} />Value Bets détectées
          </h3>
          <div className="space-y-2">
            {pred.value_bets.map((vb: any, i: number) => (
              <div key={i} className="bg-gray-800 rounded-xl p-4 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white">{vb.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    Modèle : <span className="text-white">{(vb.model_prob * 100).toFixed(0)}%</span>
                    {" "}· Marché : <span className="text-white">{(vb.fair_prob * 100).toFixed(0)}%</span>
                    {" "}· {vb.bookmaker}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-black text-white">{vb.odds}</div>
                  <div className="text-xs text-green-400 font-bold">+{(vb.edge * 100).toFixed(1)}% edge</div>
                  <div className="text-xs text-yellow-400">Kelly {(vb.kelly_stake_pct * 100).toFixed(1)}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Calculateur de paris ───────────────────────────────────────── */
function BetCalculator({ event, pred }: { event: Event; pred: any }) {
  const [odds, setOdds] = useState("");
  const [stake, setStake] = useState("");
  const [selection, setSelection] = useState("Victoire " + event.home_team);
  const [result, setResult] = useState<any>(null);
  const [open, setOpen] = useState(true);

  const selectionMap: Record<string, number> = {
    ["Victoire " + event.home_team]: pred.prob_home,
    ["Match nul"]: pred.prob_draw,
    ["Victoire " + event.away_team]: pred.prob_away,
  };

  const markets = pred?.markets;
  if (markets?.over_under?.over_2_5 != null) {
    selectionMap["Over 2.5 buts"] = markets.over_under.over_2_5;
    selectionMap["Under 2.5 buts"] = markets.over_under.under_2_5;
  }
  if (markets?.btts?.yes != null) {
    selectionMap["Les 2 équipes marquent (Oui)"] = markets.btts.yes;
    selectionMap["Les 2 équipes marquent (Non)"] = markets.btts.no;
  }

  const analyze = () => {
    const o = parseFloat(odds);
    const s = parseFloat(stake);
    if (!o || !s || o <= 1) return;

    const modelProb = selectionMap[selection] ?? 0;
    const impliedProb = 1 / o;
    const edge = modelProb - impliedProb;
    const ev = modelProb * (o - 1) - (1 - modelProb);
    const kelly = Math.max(0, (modelProb * o - 1) / (o - 1)) * 0.25;
    const kellyStake = kelly * s * 40; // sur bankroll hypothétique = mise × 40
    const isValue = edge > 0.03 && ev > 0;
    const potentialReturn = s * o;

    setResult({ modelProb, impliedProb, edge, ev, kelly, kellyStake: Math.min(kellyStake, s), isValue, potentialReturn, o, s });
  };

  return (
    <div className="card">
      <button className="w-full flex items-center justify-between" onClick={() => setOpen(x => !x)}>
        <h3 className="font-semibold text-white flex items-center gap-2">
          <Calculator size={16} className="text-blue-400" />
          Calculateur de paris
        </h3>
        {open ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-1">
              <label className="text-xs text-gray-500 mb-1 block">Sélection</label>
              <select
                value={selection}
                onChange={e => { setSelection(e.target.value); setResult(null); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 outline-none"
              >
                {Object.keys(selectionMap).map(k => <option key={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Cote bookmaker</label>
              <input
                type="number" step="0.01" min="1.01" placeholder="ex: 2.40"
                value={odds} onChange={e => { setOdds(e.target.value); setResult(null); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Mise (€)</label>
              <input
                type="number" step="1" min="1" placeholder="ex: 50"
                value={stake} onChange={e => { setStake(e.target.value); setResult(null); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          <button
            onClick={analyze}
            disabled={!odds || !stake}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <Target size={15} />
            Analyser ce pari
          </button>

          {result && (
            <div className={clsx(
              "rounded-xl p-4 border",
              result.isValue ? "bg-green-900/20 border-green-800" : "bg-red-900/20 border-red-900"
            )}>
              <div className="flex items-center justify-between mb-3">
                <div className={clsx("text-lg font-black", result.isValue ? "text-green-400" : "text-red-400")}>
                  {result.isValue ? "✓ VALUE BET" : "✗ Pas de valeur"}
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500">Retour potentiel</div>
                  <div className="text-xl font-bold text-white">{result.potentialReturn.toFixed(2)} €</div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Stat label="Prob. modèle" value={`${(result.modelProb * 100).toFixed(1)}%`} />
                <Stat label="Prob. implicite" value={`${(result.impliedProb * 100).toFixed(1)}%`} />
                <Stat
                  label="Edge"
                  value={`${result.edge > 0 ? "+" : ""}${(result.edge * 100).toFixed(1)}%`}
                  highlight={result.edge > 0 ? "green" : "red"}
                />
                <Stat
                  label="EV / unité"
                  value={`${result.ev > 0 ? "+" : ""}${(result.ev * 100).toFixed(1)}%`}
                  highlight={result.ev > 0 ? "green" : "red"}
                />
              </div>

              <div className="mt-3 pt-3 border-t border-gray-700/50 flex items-center gap-4 text-xs text-gray-400">
                <span>Mise Kelly recommandée : <span className="text-yellow-400 font-bold">{result.kellyStake.toFixed(2)} €</span></span>
                <span className="text-gray-600">·</span>
                <span>
                  {result.isValue
                    ? "Le modèle trouve de la valeur dans ce pari."
                    : "La cote ne compense pas le risque selon le modèle."}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: "green" | "red" }) {
  return (
    <div className="bg-gray-800/60 rounded-lg p-2 text-center">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className={clsx("font-bold", highlight === "green" ? "text-green-400" : highlight === "red" ? "text-red-400" : "text-white")}>
        {value}
      </div>
    </div>
  );
}

function ConfBadge({ c }: { c?: string }) {
  const m = { high: ["badge-value", "Haute confiance"], medium: ["badge-warn", "Conf. moyenne"], low: ["badge-low", "Faible confiance"] } as const;
  if (!c || !(c in m)) return null;
  const [cls, label] = m[c as keyof typeof m];
  return <span className={cls}>{label}</span>;
}

function QualBadge({ q }: { q?: string }) {
  const m = { good: ["badge-value", "Données bonnes"], fair: ["badge-warn", "Données correctes"], poor: ["badge-risk", "Données limitées"] } as const;
  if (!q || !(q in m)) return null;
  const [cls, label] = m[q as keyof typeof m];
  return <span className={cls}>{label}</span>;
}

function statusColor(status: string) {
  return status === "FINISHED" ? "bg-gray-700 text-gray-300"
    : status === "SCHEDULED" || status === "TIMED" ? "bg-blue-900/40 text-blue-400"
    : status === "LIVE" ? "bg-green-900/60 text-green-400 animate-pulse"
    : "bg-gray-800 text-gray-400";
}
