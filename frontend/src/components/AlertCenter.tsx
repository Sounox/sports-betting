"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Bell,
  BellRing,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { clsx } from "clsx";
import {
  api,
  type AutomatedAlert,
  type AutomatedAlertsResponse,
} from "@/lib/api";

const TYPE_LABELS: Record<AutomatedAlert["type"], string> = {
  new_value: "Value",
  french_odds: "Cote FR",
  strong_move: "Marché",
};

function dateLabel(value: string) {
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AlertCenter() {
  const [data, setData] = useState<AutomatedAlertsResponse | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = async (scan = false) => {
    setError("");
    try {
      const response = scan
        ? await api.scanAutomatedAlerts()
        : await api.getAutomatedAlerts(12);
      setData(response);
      if (scan && response.inserted_alerts) setExpanded(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Alertes indisponibles.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    await load(true);
  };

  const markAllRead = async () => {
    try {
      setData(await api.markAutomatedAlertsRead({ all: true }));
    } catch {
      setError("Impossible de marquer les alertes comme lues.");
    }
  };

  if (loading) {
    return (
      <div className="card flex items-center gap-3 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin" />
        Chargement des alertes marché...
      </div>
    );
  }

  const alerts = data?.alerts || [];
  const visibleAlerts = expanded ? alerts : alerts.slice(0, 3);

  return (
    <section className="overflow-hidden rounded-2xl border border-sky-500/20 bg-gradient-to-br from-gray-950 via-gray-900 to-sky-950/25">
      <div className="flex items-center gap-3 p-3 sm:p-4">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={expanded}
        >
          <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-sky-400/20 bg-sky-400/10 text-sky-300">
            {(data?.unread_count || 0) > 0 ? (
              <BellRing size={19} />
            ) : (
              <Bell size={19} />
            )}
            {(data?.unread_count || 0) > 0 && (
              <span className="absolute -right-1.5 -top-1.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-sky-400 px-1 text-[10px] font-black text-gray-950">
                {Math.min(data?.unread_count || 0, 99)}
              </span>
            )}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 font-bold text-white">
              Alertes marché
              {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </span>
            <span className="mt-0.5 block truncate text-xs text-gray-400">
              {(data?.unread_count || 0) > 0
                ? `${data?.unread_count} alerte${data?.unread_count === 1 ? "" : "s"} non lue${data?.unread_count === 1 ? "" : "s"}`
                : alerts.length
                  ? `${alerts.length} signal${alerts.length === 1 ? "" : "s"} actif${alerts.length === 1 ? "" : "s"}`
                : "Aucun signal important pour le moment"}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-gray-700 bg-gray-900 text-gray-300 transition hover:border-sky-500/40 hover:text-sky-300 disabled:opacity-50"
          aria-label="Scanner maintenant"
        >
          {refreshing ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <RefreshCw size={15} />
          )}
        </button>
      </div>

      {(expanded || alerts.length > 0 || error) && (
        <div className="border-t border-gray-800/80 px-3 pb-3 pt-3 sm:px-4 sm:pb-4">
          {error && (
            <div className="mb-3 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">
              <CircleAlert size={14} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {visibleAlerts.length ? (
            <div className="space-y-2">
              {visibleAlerts.map((alert) => (
                <AlertItem key={alert.id} alert={alert} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-700 p-4 text-center text-sm text-gray-500">
              Le prochain passage automatique analysera les nouvelles values et
              variations de cote.
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <ShieldCheck size={13} />
              {data?.guardrail}
            </div>
            <div className="flex items-center gap-3">
              {(data?.unread_count || 0) > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-xs font-medium text-gray-400 hover:text-white"
                >
                  Tout marquer comme lu
                </button>
              )}
              {alerts.length > 3 && (
                <button
                  type="button"
                  onClick={() => setExpanded((value) => !value)}
                  className="text-xs font-semibold text-sky-300 hover:text-sky-200"
                >
                  {expanded ? "Réduire" : "Tout afficher"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function AlertItem({ alert }: { alert: AutomatedAlert }) {
  return (
    <Link
      href={alert.href}
      className={clsx(
        "block rounded-xl border p-3 transition hover:-translate-y-0.5 hover:bg-gray-800/90",
        alert.read
          ? "border-gray-800 bg-gray-900/60"
          : alert.severity === "high"
            ? "border-amber-400/25 bg-amber-400/5"
            : "border-sky-400/20 bg-sky-400/5",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={clsx(
                "rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide",
                alert.type === "new_value"
                  ? "bg-emerald-400/10 text-emerald-300"
                  : alert.type === "french_odds"
                    ? "bg-blue-400/10 text-blue-300"
                    : "bg-amber-400/10 text-amber-300",
              )}
            >
              {TYPE_LABELS[alert.type]}
            </span>
            <span className="truncate text-sm font-bold text-white">
              {alert.title}
            </span>
          </div>
          <div className="mt-1 truncate text-xs font-medium text-gray-300">
            {alert.match}
          </div>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            {alert.message}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {alert.odds && (
            <div className="font-black tabular-nums text-white">
              {alert.odds.toFixed(2)}
            </div>
          )}
          <div className="mt-1 text-[10px] text-gray-600">
            {dateLabel(alert.created_at)}
          </div>
        </div>
      </div>
    </Link>
  );
}
