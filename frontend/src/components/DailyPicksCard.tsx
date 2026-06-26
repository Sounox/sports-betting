"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
  Ticket,
} from "lucide-react";
import { api, type DailyPicksResponse } from "@/lib/api";
import { clsx } from "clsx";

function pct(value?: number) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function odds(value?: number) {
  if (!value || !Number.isFinite(value)) return "-";
  return value.toFixed(2);
}

function dateLabel(value?: string) {
  if (!value) return "Jamais";
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DailyPicksCard() {
  const [data, setData] = useState<DailyPicksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = async (force = false) => {
    setError("");
    try {
      const response = force
        ? await api.refreshDailyPicks()
        : await api.getDailyPicks({ max_age_hours: 6 });
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Daily picks indisponibles.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await load(true);
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="card flex items-center gap-3 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin" />
        Preparation des daily picks...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card border-red-800 bg-red-950/20 text-sm text-red-200">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle size={16} />
          Daily picks indisponibles
        </div>
        <p className="mt-2 text-red-100/70">{error || "Aucune donnee retournee."}</p>
      </div>
    );
  }

  const parlay = data.multi_match_parlay.parlay;
  const singles = data.recommendations.singles.slice(0, 3);
  const radar = data.radar.suggestions.slice(0, 4);

  return (
    <section className="rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-gray-950 via-gray-900 to-emerald-950/30 p-4 shadow-2xl shadow-emerald-950/10 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-300">
            <Sparkles size={14} />
            Daily picks automatiques
          </div>
          <h2 className="mt-3 text-xl font-bold text-white">Synthese du jour</h2>
          <p className="mt-1 text-sm text-gray-400">
            Snapshot {data.storage} genere le {dateLabel(data.generated_at)}.
          </p>
          {data.stale && (
            <p className="mt-2 text-xs text-yellow-300">
              Snapshot ancien retourne car la generation fraiche a echoue.
            </p>
          )}
        </div>

        <button
          onClick={refresh}
          disabled={refreshing}
          className="btn-secondary flex items-center justify-center gap-2 text-sm disabled:opacity-60"
        >
          {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Regenerer
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Mini label="Matchs suivis" value={String(data.summary.upcoming_events)} />
        <Mini label="Singles" value={String(data.summary.singles)} />
        <Mini label="Radar" value={String(data.summary.radar_suggestions)} />
        <Mini
          label="Ticket"
          value={data.summary.parlay_available ? "Disponible" : "Refuse"}
          good={data.summary.parlay_available}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="rounded-2xl border border-gray-800 bg-gray-950/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-white">
              <Ticket size={17} className="text-emerald-300" />
              <span className="font-semibold">Ticket du jour</span>
            </div>
            <Link href="/parlays" className="text-xs font-medium text-emerald-300 hover:text-emerald-200">
              Ouvrir
            </Link>
          </div>

          {data.multi_match_parlay.success && parlay ? (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Mini label="Cote" value={odds(parlay.total_odds)} compact />
                <Mini label="Proba" value={pct(parlay.estimated_probability)} compact />
                <Mini
                  label="EV"
                  value={`${parlay.expected_value >= 0 ? "+" : ""}${parlay.expected_value.toFixed(3)}`}
                  compact
                  good={parlay.expected_value >= 0}
                />
              </div>
              <div className="space-y-2">
                {parlay.legs.slice(0, 3).map((leg, index) => (
                  <div key={`${leg.event_id}-${leg.id}-${index}`} className="rounded-xl bg-gray-900/80 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{leg.match}</div>
                        <div className="mt-1 truncate text-xs text-gray-400">{leg.label}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-bold text-white">{odds(leg.offered_odds || leg.fair_odds)}</div>
                        <div className="text-[11px] text-gray-500">{leg.bookmaker_display || leg.bookmaker || "Modele"}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-sm text-yellow-100">
              {data.multi_match_parlay.message ||
                "Aucun ticket sain ne respecte les garde-fous actuels."}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-800 bg-gray-950/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-white">
                <Target size={17} className="text-emerald-300" />
                <span className="font-semibold">Meilleures singles</span>
              </div>
              <Link href="/recommendations" className="text-xs font-medium text-emerald-300 hover:text-emerald-200">
                Details
              </Link>
            </div>
            <div className="mt-3 space-y-2">
              {singles.length ? (
                singles.map((single) => (
                  <Link
                    key={`${single.event_id}-${single.market}-${single.selection}`}
                    href={`/analyse/${single.event_id}`}
                    className="block rounded-xl bg-gray-900/80 p-3 transition hover:bg-gray-800"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{single.match}</div>
                        <div className="mt-1 truncate text-xs text-gray-400">{single.label}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-bold text-white">{odds(single.odds)}</div>
                        <div className="text-[11px] text-emerald-300">Edge {pct(single.edge)}</div>
                      </div>
                    </div>
                  </Link>
                ))
              ) : (
                <p className="rounded-xl bg-gray-900/80 p-3 text-sm text-gray-500">
                  Aucune single suffisamment propre pour le profil actuel.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-800 bg-gray-950/60 p-3">
            <div className="mb-3 flex items-center gap-2 text-white">
              <CheckCircle size={17} className="text-emerald-300" />
              <span className="font-semibold">Radar marches</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {radar.length ? (
                radar.map((item) => (
                  <Link
                    key={`${item.event_id}-${item.market}-${item.label}`}
                    href={`/analyse/${item.event_id}`}
                    className="rounded-xl bg-gray-900/80 p-3 transition hover:bg-gray-800"
                  >
                    <div className="truncate text-xs text-gray-500">{item.category}</div>
                    <div className="mt-1 truncate text-sm font-semibold text-white">{item.label}</div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-gray-400">{pct(item.probability)}</span>
                      <span className={clsx("font-semibold", item.score >= 60 ? "text-emerald-300" : "text-yellow-300")}>
                        score {item.score}
                      </span>
                    </div>
                  </Link>
                ))
              ) : (
                <p className="rounded-xl bg-gray-900/80 p-3 text-sm text-gray-500 sm:col-span-2">
                  Aucun signal radar propre dans le snapshot.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {(data.warnings.length > 0 || data.guardrails.length > 0) && (
        <div className="mt-4 rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs leading-5 text-yellow-100">
          {[...data.warnings, data.guardrails[0]].filter(Boolean).slice(0, 3).map((warning, index) => (
            <div key={`${warning}-${index}`} className="flex items-start gap-2">
              <AlertTriangle size={13} className="mt-1 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Mini({
  label,
  value,
  good,
  compact = false,
}: {
  label: string;
  value: string;
  good?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={clsx("rounded-xl border border-gray-800 bg-gray-900/70", compact ? "p-2" : "p-3")}>
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={clsx("mt-1 font-bold", good ? "text-emerald-300" : "text-white")}>{value}</div>
    </div>
  );
}
