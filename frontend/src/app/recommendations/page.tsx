"use client";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  XCircle,
} from "lucide-react";
import { clsx } from "clsx";
import { DataFreshnessCard } from "@/components/DataFreshnessCard";
import {
  api,
  type CalibrationSignal,
  type MarketSignal,
  type MarketRadarResponse,
  type MarketRadarSuggestion,
  type RecommendationParlay,
  type RecommendationResponse,
  type RecommendationSingle,
} from "@/lib/api";

const RISKS = [
  { value: "prudent", label: "Prudent", hint: "Mises faibles, moins de variance" },
  { value: "balanced", label: "Equilibre", hint: "Bon compromis edge/risque" },
  { value: "aggressive", label: "Agressif", hint: "Plus de variance, mise reduite" },
] as const;

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function money(value: number) {
  return `${value.toFixed(2)} EUR`;
}

export default function RecommendationsPage() {
  const [bankroll, setBankroll] = useState(1000);
  const [stake, setStake] = useState(20);
  const [targetOdds, setTargetOdds] = useState(3);
  const [riskLevel, setRiskLevel] =
    useState<"prudent" | "balanced" | "aggressive">("balanced");
  const [maxLegs, setMaxLegs] = useState(4);
  const [data, setData] = useState<RecommendationResponse | null>(null);
  const [radar, setRadar] = useState<MarketRadarResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [radarLoading, setRadarLoading] = useState(false);
  const [error, setError] = useState("");

  const loadRadar = async () => {
    setRadarLoading(true);
    try {
      setRadar(await api.getMarketRadar({ hours: 168, limit: 2, include_proxy: true }));
    } catch {
      setRadar(null);
    } finally {
      setRadarLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setData(
        await api.getRecommendations({
          bankroll,
          stake,
          target_odds: targetOdds,
          risk_level: riskLevel,
          max_legs: maxLegs,
          hours: 168,
        }),
      );
      void loadRadar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation impossible.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Sparkles size={24} className="text-green-400" />
            Recommandations du jour
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            L'outil transforme les cotes, edges, EV et garde-fous bankroll en
            decisions exploitables.
          </p>
        </div>
        {data && (
          <div className="text-xs text-gray-500">
            Genere le {new Date(data.generated_at).toLocaleString("fr-FR")}
          </div>
        )}
      </div>

      <DataFreshnessCard onAfterRefresh={load} />

      <div className="card grid grid-cols-1 md:grid-cols-5 gap-3">
        <NumberField label="Bankroll" value={bankroll} onChange={setBankroll} />
        <NumberField label="Mise souhaitee" value={stake} onChange={setStake} />
        <NumberField label="Cote cible combine" value={targetOdds} onChange={setTargetOdds} step={0.1} />
        <NumberField label="Selections max" value={maxLegs} onChange={setMaxLegs} min={2} max={8} />
        <button
          onClick={load}
          disabled={loading}
          className="btn-primary flex items-center justify-center gap-2 self-end py-2.5"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Actualiser
        </button>

        <div className="md:col-span-5 grid grid-cols-1 md:grid-cols-3 gap-2">
          {RISKS.map((risk) => (
            <button
              key={risk.value}
              onClick={() => setRiskLevel(risk.value)}
              className={clsx(
                "rounded-xl border p-3 text-left transition-colors",
                riskLevel === risk.value
                  ? "border-green-600 bg-green-900/30 text-green-300"
                  : "border-gray-800 bg-gray-900/60 text-gray-400 hover:border-gray-700",
              )}
            >
              <div className="font-semibold text-sm">{risk.label}</div>
              <div className="text-xs opacity-70 mt-0.5">{risk.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="card border-red-900 bg-red-950/30 text-red-300">
          {error}
        </div>
      )}

      {data && (
        <>
          <SummaryGrid data={data} />

          <MarketRadarPanel radar={radar} loading={radarLoading} />

          <section className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-5">
            <div className="space-y-4">
              <SectionTitle
                icon={<CheckCircle size={18} className="text-green-400" />}
                title="Paris simples a considerer"
                subtitle="Uniquement des selections avec cote bookmaker et edge positif."
              />
              {data.singles.length ? (
                <div className="space-y-3">
                  {data.singles.slice(0, 10).map((single) => (
                    <SingleCard key={`${single.event_id}-${single.market}-${single.selection}-${single.bookmaker}`} single={single} />
                  ))}
                </div>
              ) : (
                <EmptyState text="Aucun pari simple ne respecte les garde-fous actuels." />
              )}
            </div>

            <div className="space-y-4">
              <SectionTitle
                icon={<Target size={18} className="text-cyan-400" />}
                title="Combine cible"
                subtitle="Construit seulement si l'EV reste positive."
              />
              {data.parlays.length ? (
                data.parlays.map((parlay, index) => (
                  <ParlayCard key={index} parlay={parlay} />
                ))
              ) : (
                <EmptyState text="Aucun combine recommande dans ces conditions." />
              )}

              <SectionTitle
                icon={<XCircle size={18} className="text-red-400" />}
                title="A eviter"
                subtitle="Matchs sans signal suffisamment propre."
              />
              <div className="space-y-2">
                {data.avoid.slice(0, 8).map((item) => (
                  <div key={item.event_id} className="rounded-xl bg-gray-900/80 border border-gray-800 p-3">
                    <div className="font-semibold text-sm text-white">{item.match}</div>
                    <div className="text-xs text-red-300 mt-1">{item.reason}</div>
                    <div className="text-[11px] text-gray-600 mt-1">
                      {new Date(item.scheduled_at).toLocaleString("fr-FR")} - confiance {item.confidence}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <div className="card border-yellow-900/60 bg-yellow-950/20">
            <h3 className="font-semibold text-yellow-300 flex items-center gap-2 mb-2">
              <ShieldCheck size={16} />
              Garde-fous jeu responsable
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {data.guardrails.map((guardrail, index) => (
                <div key={index} className="text-xs text-yellow-100/75 flex gap-2">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  {guardrail}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 1,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500 mb-1 block">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-green-500"
      />
    </label>
  );
}

function SummaryGrid({ data }: { data: RecommendationResponse }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
      <Metric label="Matchs analyses" value={String(data.summary.upcoming_events)} />
      <Metric label="Value bets vues" value={String(data.summary.value_bets_considered)} />
      <Metric label="Simples retenus" value={String(data.summary.recommended_singles)} />
      <Metric label="Combine" value={data.summary.parlay_available ? "Oui" : "Non"} />
      <Metric label="Calibration" value={String(data.summary.calibration_adjusted || 0)} />
      <Metric label="Risque" value={data.filters.risk_level} />
    </div>
  );
}

function MarketRadarPanel({
  radar,
  loading,
}: {
  radar: MarketRadarResponse | null;
  loading: boolean;
}) {
  const grouped = (radar?.suggestions || []).reduce<Record<string, MarketRadarSuggestion[]>>(
    (acc, suggestion) => {
      acc[suggestion.category] = acc[suggestion.category] || [];
      acc[suggestion.category].push(suggestion);
      return acc;
    },
    {},
  );
  const order = [
    "Joueurs",
    "Joueurs - tirs",
    "Joueurs - discipline",
    "Buts equipe",
    "Scenario",
    "Defense",
    "Buts",
    "Corners",
    "Cartons",
    "Mi-temps",
    "Handicap",
  ];

  return (
    <div className="card space-y-4 border-emerald-900/40 bg-emerald-950/10">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h2 className="font-semibold text-white flex items-center gap-2">
            <Sparkles size={18} className="text-emerald-400" />
            Radar marches joueurs/scenarios
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Signaux a surveiller sur les prochains matchs: buteurs, passes, tirs cadres, buts equipe, corners/cartons.
          </p>
        </div>
        <div className="text-xs text-gray-500 md:text-right">
          {loading
            ? "Chargement du radar..."
            : radar
              ? `${radar.events_scanned} matchs scannes - ${radar.suggestions.length} signaux`
              : "Radar indisponible"}
        </div>
      </div>

      {loading && (
        <div className="rounded-xl bg-gray-900/80 border border-gray-800 p-4 text-sm text-gray-400 flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" />
          Analyse des marches joueurs et scenarios...
        </div>
      )}

      {!loading && radar && radar.suggestions.length === 0 && (
        <EmptyState text="Aucun signal joueur/scenario exploitable sur les prochains matchs." />
      )}

      {!loading && radar && radar.suggestions.length > 0 && (
        <div className="space-y-5">
          {order
            .filter((category) => grouped[category]?.length)
            .map((category) => (
              <div key={category}>
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-bold uppercase tracking-wide text-emerald-300">
                    {category}
                  </div>
                  <div className="text-[11px] text-gray-600">
                    {grouped[category].length} signal(aux)
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {grouped[category].slice(0, 6).map((suggestion) => (
                    <RadarCard key={`${suggestion.event_id}-${suggestion.category}-${suggestion.label}`} suggestion={suggestion} />
                  ))}
                </div>
              </div>
            ))}

          <div className="rounded-xl border border-yellow-900/60 bg-yellow-950/20 p-3 space-y-1">
            {radar.warnings.map((warning, index) => (
              <div key={index} className="text-xs text-yellow-200/75 flex gap-2">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                {warning}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RadarCard({ suggestion }: { suggestion: MarketRadarSuggestion }) {
  const playable = suggestion.data_level === "bookmaker" && suggestion.offered_odds;
  return (
    <Link
      href={`/analyse/${suggestion.event_id}`}
      className="rounded-xl border border-gray-800 bg-gray-900/80 p-3 hover:border-emerald-700/70 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-white text-sm leading-snug">{suggestion.label}</div>
          <div className="text-xs text-gray-500 mt-1 truncate">{suggestion.match}</div>
        </div>
        <span className="rounded-full bg-emerald-900/40 text-emerald-300 px-2 py-1 text-[11px] font-bold">
          {suggestion.score.toFixed(0)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3">
        <Mini label="Modele" value={pct(suggestion.probability)} />
        <Mini
          label={playable ? suggestion.bookmaker || "Book" : "Cote fair"}
          value={(playable ? suggestion.offered_odds : suggestion.fair_odds)?.toFixed(2) || "n/a"}
          good={Boolean(playable)}
        />
        <Mini
          label="Edge"
          value={suggestion.edge == null ? "n/a" : `${suggestion.edge > 0 ? "+" : ""}${pct(suggestion.edge)}`}
          good={(suggestion.edge || 0) > 0}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {suggestion.market_signal && (
          <MarketSignalBadge signal={suggestion.market_signal} />
        )}
        <DataLevelBadge level={suggestion.data_level} />
        <span className="text-[10px] text-gray-600">Risque {suggestion.risk_level}</span>
        <span className="text-[10px] text-gray-600">Conf. {suggestion.confidence}</span>
      </div>

      <p className="text-xs text-gray-500 mt-3 line-clamp-2">{suggestion.rationale}</p>
      <p className="text-[11px] text-yellow-500/80 mt-2 line-clamp-2">{suggestion.data_note}</p>
    </Link>
  );
}

function DataLevelBadge({ level }: { level: MarketRadarSuggestion["data_level"] }) {
  return (
    <span
      className={clsx(
        "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        level === "bookmaker"
          ? "bg-green-900/40 text-green-300"
          : level === "proxy"
            ? "bg-red-900/40 text-red-300"
            : "bg-blue-900/40 text-blue-300",
      )}
    >
      {level === "bookmaker" ? "cote bookmaker" : level === "proxy" ? "proxy" : "modele"}
    </span>
  );
}

function MarketSignalBadge({ signal }: { signal: MarketSignal }) {
  const label =
    signal.verdict === "favorable"
      ? "marche favorable"
      : signal.verdict === "unfavorable"
        ? "marche defavorable"
        : signal.verdict === "insufficient"
          ? "historique court"
          : "marche stable";
  return (
    <span
      title={signal.reason}
      className={clsx(
        "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        signal.verdict === "favorable"
          ? "bg-green-900/40 text-green-300"
          : signal.verdict === "unfavorable"
            ? "bg-red-900/40 text-red-300"
            : "bg-gray-800 text-gray-400",
      )}
    >
      {label}
    </span>
  );
}

function CalibrationSignalBadge({ signal }: { signal: CalibrationSignal }) {
  const label =
    signal.verdict === "overconfident"
      ? "modele trop confiant"
      : signal.verdict === "underconfident"
        ? "modele prudent"
        : signal.verdict === "reliable"
          ? "calibration ok"
          : "calibration courte";
  return (
    <span
      title={signal.reason}
      className={clsx(
        "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        signal.verdict === "overconfident"
          ? "bg-orange-900/45 text-orange-300"
          : signal.verdict === "underconfident"
            ? "bg-cyan-900/40 text-cyan-300"
            : signal.verdict === "reliable"
              ? "bg-blue-900/40 text-blue-300"
              : "bg-gray-800 text-gray-400",
      )}
    >
      {label}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="text-xl font-black text-white">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div>
      <h2 className="font-semibold text-white flex items-center gap-2">
        {icon}
        {title}
      </h2>
      <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
    </div>
  );
}

function SingleCard({ single }: { single: RecommendationSingle }) {
  return (
    <div className="card hover:border-gray-700 transition-colors">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="rounded-xl bg-green-900/40 text-green-300 px-2.5 py-1 text-xs font-bold">
              Score {single.score.toFixed(0)}
            </span>
            <span className="rounded-xl bg-gray-800 px-2.5 py-1 text-xs text-gray-400">
              {single.market}
            </span>
            <span className="rounded-xl bg-gray-800 px-2.5 py-1 text-xs text-gray-400">
              {single.confidence}
            </span>
            {single.market_signal && (
              <MarketSignalBadge signal={single.market_signal} />
            )}
            {single.calibration_signal && (
              <CalibrationSignalBadge signal={single.calibration_signal} />
            )}
          </div>
          <Link href={`/analyse/${single.event_id}`} className="font-bold text-white mt-3 block hover:text-green-300">
            {single.match}
          </Link>
          <div className="text-sm text-gray-300 mt-1">{single.label}</div>
          <div className="text-xs text-gray-500 mt-1">
            {single.bookmaker} - {new Date(single.scheduled_at).toLocaleString("fr-FR")}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:min-w-[430px]">
          <Mini label="Cote" value={single.odds.toFixed(2)} />
          <Mini label="Modele" value={pct(single.model_prob)} />
          <Mini label="Edge" value={`+${pct(single.edge)}`} good />
          <Mini label="Mise reco" value={money(single.recommended_stake)} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
        {single.reasons.slice(0, 3).map((reason, index) => (
          <div key={index} className="text-xs text-green-200/70 bg-green-950/20 border border-green-900/40 rounded-lg p-2">
            {reason}
          </div>
        ))}
        {single.warnings.slice(0, 3).map((warning, index) => (
          <div key={index} className="text-xs text-yellow-200/70 bg-yellow-950/20 border border-yellow-900/40 rounded-lg p-2">
            {warning}
          </div>
        ))}
      </div>
    </div>
  );
}

function ParlayCard({ parlay }: { parlay: RecommendationParlay }) {
  return (
    <div className="card border-cyan-900/60 bg-cyan-950/10 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Mini label="Cote totale" value={parlay.total_odds.toFixed(2)} good />
        <Mini label="Proba approx." value={pct(parlay.theoretical_probability)} />
        <Mini label="Mise reco" value={money(parlay.stake)} />
        <Mini label="Retour potentiel" value={money(parlay.potential_return)} />
      </div>
      <div className="space-y-2">
        {parlay.legs.map((leg) => (
          <div key={`${leg.event_id}-${leg.market}-${leg.selection}`} className="rounded-xl bg-gray-900/80 border border-gray-800 p-3">
            <div className="font-semibold text-white text-sm">{leg.match}</div>
            <div className="text-xs text-gray-400 mt-1">
              {leg.label} - cote {leg.odds.toFixed(2)} - {leg.bookmaker}
            </div>
            <div className="text-xs text-green-400 mt-1">
              Edge +{pct(leg.edge)} - modele {pct(leg.model_prob)}
            </div>
            {leg.market_signal && (
              <div className="mt-2">
                <MarketSignalBadge signal={leg.market_signal} />
              </div>
            )}
            {leg.calibration_signal && (
              <div className="mt-2">
                <CalibrationSignalBadge signal={leg.calibration_signal} />
              </div>
            )}
          </div>
        ))}
      </div>
      {parlay.warnings.map((warning, index) => (
        <div key={index} className="text-xs text-yellow-300/80">
          {warning}
        </div>
      ))}
    </div>
  );
}

function Mini({
  label,
  value,
  good = false,
}: {
  label: string;
  value: string;
  good?: boolean;
}) {
  return (
    <div className="rounded-lg bg-gray-800/80 p-2">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={clsx("font-bold text-sm", good ? "text-green-300" : "text-white")}>
        {value}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="card text-center text-gray-500 py-10">
      {text}
    </div>
  );
}
