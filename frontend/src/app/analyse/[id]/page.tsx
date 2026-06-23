"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, type Event } from "@/lib/api";
import { AlertTriangle, Loader2, RefreshCw, TrendingUp } from "lucide-react";
import { clsx } from "clsx";

export default function AnalysePage() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [predicting, setPredicting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getEvent(Number(id));
      setEvent(data);
    } finally {
      setLoading(false);
    }
  };

  const runPrediction = async () => {
    setPredicting(true);
    try {
      await api.predictEvent(Number(id));
      await load();
    } finally {
      setPredicting(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-gray-500" size={32} />
    </div>
  );

  if (!event) return <div className="card text-gray-500">Événement non trouvé</div>;

  const pred = event.prediction;
  const markets = pred?.markets;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-500">{event.competition}</span>
          <span className={clsx("text-xs px-2 py-0.5 rounded-full", statusColor(event.status))}>
            {event.status}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-center flex-1">
            <div className="text-2xl font-bold text-white">{event.home_team}</div>
            {pred && <div className="text-3xl font-black text-green-400 mt-1">{(pred.prob_home! * 100).toFixed(0)}%</div>}
          </div>
          <div className="text-center px-6">
            <div className="text-gray-400 text-sm">VS</div>
            {pred && <div className="text-lg font-bold text-gray-300 mt-1">{(pred.prob_draw! * 100).toFixed(0)}% nul</div>}
          </div>
          <div className="text-center flex-1">
            <div className="text-2xl font-bold text-white">{event.away_team}</div>
            {pred && <div className="text-3xl font-black text-blue-400 mt-1">{(pred.prob_away! * 100).toFixed(0)}%</div>}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          {pred ? (
            <div className="flex gap-2">
              <ConfBadge c={pred.confidence} />
              <QualBadge q={pred.data_quality} />
            </div>
          ) : <span />}
          <button onClick={runPrediction} disabled={predicting} className="btn-secondary flex items-center gap-2 text-sm">
            {predicting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {pred ? "Recalculer" : "Calculer la prédiction"}
          </button>
        </div>

        {pred?.warning_flags && pred.warning_flags.length > 0 && (
          <div className="mt-3 flex gap-2 flex-wrap">
            {pred.warning_flags.map((w, i) => (
              <div key={i} className="flex items-center gap-1 text-xs text-yellow-400 bg-yellow-900/20 px-2 py-1 rounded-lg">
                <AlertTriangle size={10} />
                {w.replace(/_/g, " ")}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Marchés */}
      {markets && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {markets["1x2"] && <MarketCard title="Résultat 1X2" data={[
            { label: event.home_team, prob: markets["1x2"].home },
            { label: "Nul", prob: markets["1x2"].draw },
            { label: event.away_team, prob: markets["1x2"].away },
          ]} />}

          {markets["over_under"] && <MarketCard title="Over / Under" data={[
            { label: "Over 0.5", prob: markets["over_under"].over_0_5 },
            { label: "Over 1.5", prob: markets["over_under"].over_1_5 },
            { label: "Over 2.5", prob: markets["over_under"].over_2_5 },
            { label: "Over 3.5", prob: markets["over_under"].over_3_5 },
            { label: "Under 2.5", prob: markets["over_under"].under_2_5 },
          ].filter(x => x.prob)} />}

          {markets["btts"] && <MarketCard title="Les deux équipes marquent" data={[
            { label: "Oui", prob: markets["btts"].yes },
            { label: "Non", prob: markets["btts"].no },
          ]} />}

          {markets["half_time"] && <MarketCard title="Mi-temps" data={[
            { label: event.home_team, prob: markets["half_time"].home },
            { label: "Nul", prob: markets["half_time"].draw },
            { label: event.away_team, prob: markets["half_time"].away },
          ]} />}
        </div>
      )}

      {/* Top scores */}
      {markets?.top_scores && (
        <div className="card">
          <h3 className="font-semibold text-gray-300 mb-3">Scores les plus probables</h3>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
            {markets.top_scores.slice(0, 10).map((s: any, i: number) => (
              <div key={i} className={clsx(
                "rounded-xl p-3 text-center",
                i === 0 ? "bg-green-900/40 border border-green-700" : "bg-gray-800"
              )}>
                <div className="text-xl font-bold text-white">{s.score}</div>
                <div className="text-xs text-gray-400 mt-1">{(s.prob * 100).toFixed(1)}%</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Value bets du match */}
      {pred?.value_bets && pred.value_bets.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-green-400 mb-3 flex items-center gap-2">
            <TrendingUp size={16} />
            Value Bets détectées
          </h3>
          <div className="space-y-2">
            {pred.value_bets.map((vb: any, i: number) => (
              <div key={i} className="bg-gray-800 rounded-lg p-3 flex items-center justify-between">
                <div>
                  <div className="font-medium text-white text-sm">{vb.label}</div>
                  <div className="text-xs text-gray-400">
                    Modèle : {(vb.model_prob * 100).toFixed(0)}% | Marché : {(vb.fair_prob * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-white">{vb.odds}</div>
                  <div className="text-xs text-green-400">+{(vb.edge * 100).toFixed(1)}% edge</div>
                  <div className="text-xs text-gray-500">{vb.bookmaker}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MarketCard({ title, data }: { title: string; data: { label: string; prob: number }[] }) {
  const sorted = [...data].sort((a, b) => b.prob - a.prob);
  return (
    <div className="card">
      <h3 className="font-semibold text-gray-300 mb-3 text-sm">{title}</h3>
      <div className="space-y-2">
        {sorted.map((item, i) => (
          <div key={i}>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-300">{item.label}</span>
              <span className="font-bold text-white">{(item.prob * 100).toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={clsx("h-full rounded-full", i === 0 ? "bg-green-500" : "bg-gray-600")}
                style={{ width: `${Math.min(item.prob * 100, 100)}%` }}
              />
            </div>
          </div>
        ))}
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
  return status === "FINISHED" ? "bg-gray-700 text-gray-300" :
         status === "scheduled" ? "bg-blue-900/40 text-blue-400" :
         status === "LIVE" ? "bg-green-900/60 text-green-400 animate-pulse" :
         "bg-gray-800 text-gray-400";
}
