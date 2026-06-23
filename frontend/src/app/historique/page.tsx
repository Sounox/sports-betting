"use client";

import { useEffect, useState } from "react";
import {
  api,
  type EventHistoryResponse,
  type HistorySnapshotResponse,
  type HistoryStatus,
} from "@/lib/api";
import { AlertTriangle, Database, Loader2, RefreshCw, Search } from "lucide-react";

export default function HistoriquePage() {
  const [status, setStatus] = useState<HistoryStatus | null>(null);
  const [eventId, setEventId] = useState("");
  const [eventHistory, setEventHistory] = useState<EventHistoryResponse | null>(null);
  const [snapshot, setSnapshot] = useState<HistorySnapshotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await api.getHistoryStatus());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const createSnapshot = async () => {
    setWorking(true);
    setError(null);
    try {
      const next = await api.createHistorySnapshot(168);
      setSnapshot(next);
      setStatus(await api.getHistoryStatus());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  };

  const searchEvent = async () => {
    if (!eventId.trim()) return;
    setWorking(true);
    setError(null);
    try {
      setEventHistory(await api.getEventHistory(Number(eventId), 30));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setWorking(false);
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
            <Database size={24} className="text-green-400" />
            Historique & snapshots
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Base des captures pre-match: predictions, cotes bookmakers et value bets.
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

      {!loading && status && !status.enabled && (
        <div className="card border-yellow-800 bg-yellow-950/20">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-yellow-300">Stockage durable non configure</p>
              <p className="text-sm text-yellow-200/80 mt-1">
                {status.message || "Il manque le binding Cloudflare D1 SPORTSBET_DB."}
              </p>
              <p className="text-xs text-gray-500 mt-2">
                Le code est pret. Des que D1 est branche, les crons sauvegardent l'historique automatiquement.
              </p>
            </div>
          </div>
        </div>
      )}

      {status?.enabled && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Metric label="Matchs" value={status.events_total || 0} />
          <Metric label="Predictions" value={status.prediction_snapshots || 0} />
          <Metric label="Cotes" value={status.odds_price_snapshots || 0} />
          <Metric label="Value bets" value={status.value_bet_snapshots || 0} />
          <Metric label="Refresh runs" value={status.refresh_runs || 0} />
        </div>
      )}

      <div className="card">
        <h2 className="font-semibold text-white mb-2">Snapshot manuel</h2>
        <p className="text-sm text-gray-500 mb-4">
          Force une capture des matchs, predictions et cotes des 7 prochains jours.
        </p>
        <button
          onClick={createSnapshot}
          disabled={working}
          className="btn-primary flex items-center gap-2"
        >
          {working ? <Loader2 size={15} className="animate-spin" /> : <Database size={15} />}
          Creer un snapshot
        </button>
        {snapshot && (
          <div className="mt-4 rounded-xl bg-gray-800/70 border border-gray-700 p-3 text-sm text-gray-300">
            {snapshot.saved
              ? `${snapshot.predictions_saved || 0} predictions, ${snapshot.odds_saved || 0} lignes de cotes, ${snapshot.value_bets_saved || 0} value bets sauvegardees.`
              : snapshot.message || "Snapshot non sauvegarde."}
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="font-semibold text-white mb-2">Historique d'un match</h2>
        <div className="flex gap-2">
          <input
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            placeholder="ID match, ex: 537411"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none"
          />
          <button onClick={searchEvent} disabled={working} className="btn-secondary flex items-center gap-2">
            <Search size={15} />
            Chercher
          </button>
        </div>

        {eventHistory?.enabled && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
            <Metric label="Snapshots prediction" value={eventHistory.predictions?.length || 0} />
            <Metric label="Lignes de cotes" value={eventHistory.odds?.length || 0} />
            <Metric label="Value bets" value={eventHistory.value_bets?.length || 0} />
          </div>
        )}

        {eventHistory && !eventHistory.enabled && (
          <p className="text-sm text-yellow-300 mt-4">
            {eventHistory.message || "Historique non configure."}
          </p>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <div className="text-xl font-bold text-white">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}
