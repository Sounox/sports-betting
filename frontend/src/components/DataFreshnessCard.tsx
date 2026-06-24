"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle, Clock, Database, Loader2, RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { api, type HistoryStatus } from "@/lib/api";

type Freshness = "fresh" | "watch" | "stale" | "unknown";

interface DataFreshnessCardProps {
  compact?: boolean;
  onAfterRefresh?: () => void | Promise<void>;
}

function latestRunDate(status: HistoryStatus | null) {
  const raw =
    status?.latest_automation?.finished_at ||
    status?.latest_automation?.started_at ||
    status?.latest_refresh?.finished_at ||
    status?.latest_refresh?.started_at;
  return raw ? new Date(raw) : null;
}

function freshnessFromDate(date: Date | null): Freshness {
  if (!date) return "unknown";
  const ageMinutes = (Date.now() - date.getTime()) / 60000;
  if (ageMinutes <= 270) return "fresh";
  if (ageMinutes <= 420) return "watch";
  return "stale";
}

function nextScheduledRun(now: Date, everyHours: number, minute: number) {
  for (let offset = 0; offset <= 48; offset += 1) {
    const candidate = new Date(now);
    candidate.setHours(now.getHours() + offset, minute, 0, 0);
    if (candidate.getHours() % everyHours === 0 && candidate.getTime() > now.getTime()) {
      return candidate;
    }
  }
  return null;
}

function freshnessCopy(freshness: Freshness) {
  if (freshness === "fresh") {
    return {
      label: "Donnees fraiches",
      detail: "Les recommandations utilisent un snapshot recent.",
      className: "border-green-800 bg-green-950/25 text-green-300",
      icon: <CheckCircle size={16} />,
    };
  }
  if (freshness === "watch") {
    return {
      label: "A surveiller",
      detail: "Les donnees restent exploitables, mais un refresh approche.",
      className: "border-yellow-800 bg-yellow-950/25 text-yellow-300",
      icon: <Clock size={16} />,
    };
  }
  if (freshness === "stale") {
    return {
      label: "Donnees anciennes",
      detail: "Force une mise a jour avant de te fier aux cotes.",
      className: "border-red-800 bg-red-950/25 text-red-300",
      icon: <AlertTriangle size={16} />,
    };
  }
  return {
    label: "Statut inconnu",
    detail: "Le stockage historique n'a pas encore renvoye de snapshot.",
    className: "border-gray-800 bg-gray-900/70 text-gray-300",
    icon: <Database size={16} />,
  };
}

export function DataFreshnessCard({ compact = false, onAfterRefresh }: DataFreshnessCardProps) {
  const [status, setStatus] = useState<HistoryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const latestDate = latestRunDate(status);
  const freshness = freshnessFromDate(latestDate);
  const copy = freshnessCopy(freshness);
  const nextRuns = useMemo(() => {
    const now = new Date();
    return {
      fast: nextScheduledRun(now, 4, 0),
      full: nextScheduledRun(now, 6, 15),
    };
  }, [status?.latest_automation?.started_at]);

  const load = async () => {
    setError("");
    try {
      setStatus(await api.getHistoryStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Statut donnees indisponible.");
    } finally {
      setLoading(false);
    }
  };

  const forceRefresh = async () => {
    setRefreshing(true);
    setError("");
    try {
      await api.runDataRefresh("full");
      await load();
      await onAfterRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mise a jour impossible.");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="card flex items-center gap-3 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin" />
        Verification de la fraicheur des donnees...
      </div>
    );
  }

  return (
    <div className={clsx("card", compact ? "p-3" : "p-4")}>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={clsx("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold", copy.className)}>
              {copy.icon}
              {copy.label}
            </span>
            <span className="text-xs text-gray-500">
              Cloudflare cron actif: rapide 4h, complet 6h
            </span>
          </div>
          <p className="text-sm text-gray-300 mt-3">{copy.detail}</p>
          {error && <p className="text-xs text-red-300 mt-2">{error}</p>}
        </div>

        <button
          onClick={forceRefresh}
          disabled={refreshing}
          className="btn-secondary flex items-center justify-center gap-2 text-sm lg:min-w-[190px]"
        >
          {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Forcer la mise a jour
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <Mini label="Derniere MAJ" value={latestDate ? latestDate.toLocaleString("fr-FR") : "Jamais"} />
        <Mini label="Prochaine rapide" value={nextRuns.fast ? nextRuns.fast.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "Auto"} />
        <Mini label="Lignes cotes" value={String(status?.odds_price_snapshots || 0)} />
        <Mini label="Value bets" value={String(status?.value_bet_snapshots || 0)} />
      </div>

      {!compact && status?.latest_automation && (
        <div className="mt-3 rounded-xl border border-gray-800 bg-gray-950/40 p-3 text-xs text-gray-400">
          Derniere execution: {status.latest_automation.status} / {status.latest_automation.mode} / {status.latest_automation.trigger}
          {" - "}
          {status.latest_automation.upcoming_seen} matchs a venir, {status.latest_automation.odds_saved} lignes cotes, {status.latest_automation.contexts_warmed} contextes IA.
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-gray-800/70 border border-gray-700 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-bold text-white mt-1 truncate">{value}</div>
    </div>
  );
}
