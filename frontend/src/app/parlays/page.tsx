"use client";

import { useState } from "react";
import {
  api,
  type MatchParlayRiskProfile,
  type MatchParlayScanResponse,
} from "@/lib/api";
import {
  AlertTriangle,
  CheckCircle,
  Layers,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { clsx } from "clsx";

const RISK_LEVELS: Array<{
  value: MatchParlayRiskProfile;
  label: string;
  desc: string;
  color: "green" | "yellow" | "red";
}> = [
  {
    value: "prudent",
    label: "Prudent",
    desc: "Moins de variance, filtres stricts",
    color: "green",
  },
  {
    value: "balanced",
    label: "Equilibre",
    desc: "Bon compromis cote / fiabilite",
    color: "yellow",
  },
  {
    value: "aggressive",
    label: "Agressif",
    desc: "Plus de variance, plus flexible",
    color: "red",
  },
];

function formatOdds(value?: number) {
  if (!value || !Number.isFinite(value)) return "-";
  return value.toFixed(2);
}

function formatPct(value?: number) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function sourceLabel(source?: string, bookmaker?: string) {
  if (bookmaker) return bookmaker;
  if (source === "model") return "Modele";
  if (source === "proxy") return "Proxy";
  return "Non precise";
}

export default function ParlaysPage() {
  const [targetOdds, setTargetOdds] = useState(3);
  const [stake, setStake] = useState(20);
  const [riskLevel, setRiskLevel] = useState<MatchParlayRiskProfile>("balanced");
  const [maxLegs, setMaxLegs] = useState(4);
  const [hours, setHours] = useState(168);
  const [maxEvents, setMaxEvents] = useState(6);
  const [onlyFrench, setOnlyFrench] = useState(false);
  const [bookmakerOnly, setBookmakerOnly] = useState(false);
  const [excludePlayers, setExcludePlayers] = useState(false);
  const [result, setResult] = useState<MatchParlayScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await api.scanMultiMatchParlay({
        target_odds: targetOdds,
        stake,
        risk_profile: riskLevel,
        max_legs: maxLegs,
        hours,
        max_events: maxEvents,
        require_french_odds: onlyFrench,
        bookmaker_only: bookmakerOnly,
        exclude_player_props: excludePlayers,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-10">
      <div className="rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/45 via-gray-900 to-gray-950 p-4 shadow-2xl shadow-emerald-950/20 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
              <Search size={14} />
              Scanner multi-match
            </div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-white sm:text-3xl">
              <Layers size={26} className="text-emerald-300" />
              Generateur de combines
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
              Donne une cote cible et une mise. L'outil scanne les prochains matchs,
              compare les probabilites, evite les doublons sur un meme match et refuse
              le ticket si la combinaison est trop fragile.
            </p>
          </div>
          <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs leading-5 text-yellow-200 sm:max-w-xs">
            Aucun pari n'est sur. Un combine augmente fortement la variance:
            utilise une mise faible et ne cherche jamais a te refaire.
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="card space-y-5">
          <div className="flex items-center gap-2 text-white">
            <SlidersHorizontal size={18} className="text-emerald-300" />
            <h2 className="font-semibold">Parametres du ticket</h2>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {RISK_LEVELS.map((risk) => (
              <button
                key={risk.value}
                type="button"
                onClick={() => setRiskLevel(risk.value)}
                className={clsx(
                  "rounded-2xl border p-3 text-left transition",
                  riskLevel === risk.value
                    ? risk.color === "green"
                      ? "border-emerald-500 bg-emerald-500/15 text-emerald-200"
                      : risk.color === "yellow"
                        ? "border-yellow-500 bg-yellow-500/15 text-yellow-200"
                        : "border-red-500 bg-red-500/15 text-red-200"
                    : "border-gray-800 bg-gray-900/70 text-gray-400 hover:border-gray-700",
                )}
              >
                <div className="text-sm font-semibold">{risk.label}</div>
                <div className="mt-1 hidden text-xs opacity-75 sm:block">{risk.desc}</div>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Cote cible"
              min={1.1}
              max={50}
              step={0.1}
              value={targetOdds}
              onChange={setTargetOdds}
            />
            <NumberField
              label="Mise"
              min={1}
              max={10000}
              step={1}
              suffix="EUR"
              value={stake}
              onChange={setStake}
            />
            <NumberField
              label="Selections max"
              min={1}
              max={5}
              step={1}
              value={maxLegs}
              onChange={setMaxLegs}
            />
            <NumberField
              label="Matchs scannes"
              min={2}
              max={8}
              step={1}
              value={maxEvents}
              onChange={setMaxEvents}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-400">Fenetre de scan</label>
            <select
              value={hours}
              onChange={(event) => setHours(Number(event.target.value))}
              className="w-full rounded-xl border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
            >
              <option value={48}>48h</option>
              <option value={168}>7 jours</option>
              <option value={336}>14 jours</option>
              <option value={720}>30 jours</option>
            </select>
          </div>

          <div className="space-y-2 rounded-2xl border border-gray-800 bg-gray-950/50 p-3">
            <Toggle
              label="Cotes FR seulement"
              description="Filtre Winamax, Betclic, Unibet FR, PMU si disponibles."
              checked={onlyFrench}
              onChange={setOnlyFrench}
            />
            <Toggle
              label="Cotes bookmaker uniquement"
              description="Exclut les cotes calculees par le modele."
              checked={bookmakerOnly}
              onChange={setBookmakerOnly}
            />
            <Toggle
              label="Sans joueurs / buteurs"
              description="Retire les marches plus volatils lies aux joueurs."
              checked={excludePlayers}
              onChange={setExcludePlayers}
            />
          </div>

          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="btn-primary flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              "Scan en cours..."
            ) : (
              <>
                <Search size={16} />
                Scanner les meilleurs tickets
              </>
            )}
          </button>
        </div>

        <div className="space-y-4">
          {!result && !error && (
            <div className="card flex min-h-[360px] flex-col items-center justify-center text-center">
              <ShieldCheck size={38} className="mb-4 text-emerald-300" />
              <h2 className="text-lg font-semibold text-white">Pret a scanner</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-gray-400">
                Lance le scan pour obtenir un ticket multi-match. Le moteur privilegie
                les selections avec probabilite, fiabilite et signal de marche coherents.
              </p>
            </div>
          )}

          {error && (
            <FailureCard
              title="Erreur pendant le scan"
              message={error}
              warnings={["Verifie que le deploiement est actif puis relance le scan."]}
            />
          )}

          {result && (
            result.success && result.parlay ? (
              <ParlaySuccess result={result} />
            ) : (
              <FailureCard
                title="Aucun combine recommande"
                message={result.message || "Aucune combinaison saine ne respecte ces filtres."}
                warnings={result.warnings || []}
                meta={`${result.events_scanned || 0} matchs scans - ${result.candidates_considered || 0} selections considerees`}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-gray-400">{label}</span>
      <div className="flex items-center rounded-xl border border-gray-800 bg-gray-900 focus-within:border-emerald-500">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full rounded-xl bg-transparent px-3 py-2 text-sm text-white outline-none"
        />
        {suffix && <span className="pr-3 text-xs text-gray-500">{suffix}</span>}
      </div>
    </label>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-xl p-2 text-left transition hover:bg-gray-900"
    >
      <span>
        <span className="block text-sm font-medium text-gray-200">{label}</span>
        <span className="block text-xs text-gray-500">{description}</span>
      </span>
      <span
        className={clsx(
          "relative h-6 w-11 shrink-0 rounded-full border transition",
          checked ? "border-emerald-500 bg-emerald-500/30" : "border-gray-700 bg-gray-800",
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white transition",
            checked ? "left-5" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}

function ParlaySuccess({ result }: { result: MatchParlayScanResponse }) {
  const parlay = result.parlay!;

  return (
    <div className="card border-emerald-500/30 bg-emerald-950/10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle size={20} className="text-emerald-300" />
          <div>
            <h2 className="font-bold text-white">Ticket propose</h2>
            <p className="text-xs text-gray-500">
              {result.events_scanned || 0} matchs scans - {result.candidates_considered || 0} selections considerees
            </p>
          </div>
        </div>
        <span className="w-fit rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200">
          Profil {result.risk_profile}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Cote totale" value={formatOdds(parlay.total_odds)} highlight />
        <Stat label="Probabilite" value={formatPct(parlay.estimated_probability)} />
        <Stat
          label="EV estimee"
          value={`${parlay.expected_value >= 0 ? "+" : ""}${parlay.expected_value.toFixed(3)}`}
          className={parlay.expected_value >= 0 ? "text-emerald-300" : "text-yellow-300"}
        />
        <Stat
          label="Retour potentiel"
          value={parlay.potential_return ? `${parlay.potential_return.toFixed(2)} EUR` : "-"}
        />
      </div>

      <div className="mt-4 space-y-3">
        {parlay.legs.map((leg, index) => {
          const odds = leg.offered_odds || leg.fair_odds;
          return (
            <div
              key={`${leg.event_id}-${leg.id}-${index}`}
              className="rounded-2xl border border-gray-800 bg-gray-950/70 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{leg.match}</div>
                  <div className="mt-1 text-xs text-gray-500">{leg.competition}</div>
                </div>
                <div className="rounded-xl bg-gray-900 px-3 py-2 text-right">
                  <div className="text-lg font-bold text-white">{formatOdds(odds)}</div>
                  <div className="text-[11px] text-gray-500">
                    {sourceLabel(leg.odds_source, leg.bookmaker_display || leg.bookmaker)}
                  </div>
                </div>
              </div>
              <div className="mt-3 rounded-xl bg-gray-900/70 p-3">
                <div className="text-sm font-medium text-emerald-200">{leg.label}</div>
                <div className="mt-1 text-xs text-gray-400">
                  {leg.market} - {leg.selection}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <MiniMetric label="Proba" value={formatPct(leg.probability)} />
                <MiniMetric
                  label="Edge"
                  value={leg.edge == null ? "-" : `${leg.edge >= 0 ? "+" : ""}${formatPct(leg.edge)}`}
                />
                <MiniMetric
                  label="Fiabilite"
                  value={leg.reliability_score == null ? "-" : `${leg.reliability_score}/100`}
                />
              </div>
              {leg.rationale && (
                <p className="mt-3 text-xs leading-5 text-gray-500">{leg.rationale}</p>
              )}
            </div>
          );
        })}
      </div>

      <Warnings warnings={[...(result.warnings || []), ...parlay.warnings]} />
    </div>
  );
}

function FailureCard({
  title,
  message,
  warnings,
  meta,
}: {
  title: string;
  message: string;
  warnings: string[];
  meta?: string;
}) {
  return (
    <div className="card border-red-500/25 bg-red-950/10">
      <div className="flex items-start gap-3">
        <XCircle size={20} className="mt-0.5 shrink-0 text-red-300" />
        <div>
          <h2 className="font-semibold text-red-200">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-red-100/75">{message}</p>
          {meta && <p className="mt-2 text-xs text-gray-500">{meta}</p>}
        </div>
      </div>
      <Warnings warnings={warnings} />
    </div>
  );
}

function Warnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;

  return (
    <div className="mt-4 space-y-2 rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-3">
      {warnings.map((warning, index) => (
        <div key={`${warning}-${index}`} className="flex items-start gap-2 text-xs leading-5 text-yellow-200">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{warning}</span>
        </div>
      ))}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight = false,
  className = "",
}: {
  label: string;
  value: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-950/60 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={clsx("mt-1 text-lg font-bold", highlight ? "text-white" : "text-gray-300", className)}>
        {value}
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-gray-900 p-2">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="mt-0.5 font-semibold text-gray-200">{value}</div>
    </div>
  );
}
