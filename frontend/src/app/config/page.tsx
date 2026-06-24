"use client";
import { useEffect, useState, useRef } from "react";
import { api, type HistoryStatus, type SystemStatus } from "@/lib/api";
import { RefreshCw, Download, Loader2, CheckCircle, Clock, Database, Zap, Play } from "lucide-react";

const AVAILABLE_COMPS = [
  { code: "WC",  name: "FIFA World Cup 2026",  flag: "🌍" },
  { code: "CL",  name: "Champions League",      flag: "⭐" },
  { code: "PL",  name: "Premier League",        flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { code: "PD",  name: "La Liga",               flag: "🇪🇸" },
  { code: "BL1", name: "Bundesliga",            flag: "🇩🇪" },
  { code: "SA",  name: "Serie A",               flag: "🇮🇹" },
  { code: "FL1", name: "Ligue 1",               flag: "🇫🇷" },
];

function clsx(...args: (string | boolean | undefined)[]) {
  return args.filter(Boolean).join(" ");
}

export default function ConfigPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [refreshingOdds, setRefreshingOdds] = useState(false);
  const [runningPreds, setRunningPreds] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [dataRefreshing, setDataRefreshing] = useState(false);
  const [messages, setMessages] = useState<{ text: string; type: "ok" | "err" | "info" }[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [autoInterval, setAutoInterval] = useState(60);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [countdown, setCountdown] = useState(0);

  const log = (text: string, type: "ok" | "err" | "info" = "info") =>
    setMessages(m => [{ text, type }, ...m].slice(0, 20));

  const loadStatus = async () => {
    try {
      const nextStatus = await api.getStatus();
      setStatus(nextStatus);
      setHistoryStatus(nextStatus.history ?? null);
    } catch {
      try { setHistoryStatus(await api.getHistoryStatus()); } catch {}
    }
  };

  useEffect(() => { loadStatus(); }, []);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!autoRefresh) { setCountdown(0); return; }
    setCountdown(autoInterval * 60);
    const tick = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { runAutoUpdate(); return autoInterval * 60; }
        return c - 1;
      });
    }, 1000);
    intervalRef.current = tick;
    return () => clearInterval(tick);
  }, [autoRefresh, autoInterval]);

  const runAutoUpdate = async () => {
    log("⏰ Mise à jour automatique…", "info");
    try {
      await api.runDataRefresh("full");
      await loadStatus();
      log("✓ Mise à jour auto terminée", "ok");
    } catch (e: any) { log("✗ Erreur: " + e.message, "err"); }
  };

  const importComp = async (code: string) => {
    setImporting(code);
    log(`Import ${code}…`, "info");
    try {
      await api.importCompetition(code);
      await new Promise(r => setTimeout(r, 3000));
      await loadStatus();
      log(`✓ ${code} importé avec succès`, "ok");
    } catch (e: any) {
      log(`✗ Erreur ${code}: ${e.message}`, "err");
    } finally { setImporting(null); }
  };

  const doRefreshOdds = async () => {
    setRefreshingOdds(true);
    log("Rafraîchissement des cotes…", "info");
    try {
      await api.refreshOdds();
      await loadStatus();
      log("✓ Cotes mises à jour", "ok");
    } catch (e: any) { log("✗ " + e.message, "err"); }
    finally { setRefreshingOdds(false); }
  };

  const doRunPredictions = async () => {
    setRunningPreds(true);
    log("Calcul des prédictions…", "info");
    try {
      await api.runPredictions();
      await loadStatus();
      log("✓ Prédictions calculées", "ok");
    } catch (e: any) { log("✗ " + e.message, "err"); }
    finally { setRunningPreds(false); }
  };

  const doCreateSnapshot = async () => {
    setSnapshotting(true);
    log("Snapshot historique...", "info");
    try {
      const result = await api.createHistorySnapshot(168);
      await loadStatus();
      if (result.saved) {
        log(`Snapshot OK: ${result.predictions_saved || 0} predictions, ${result.odds_saved || 0} lignes de cotes`, "ok");
      } else {
        log(result.message || "Stockage historique non configure", "info");
      }
    } catch (e: any) {
      log("Erreur snapshot: " + e.message, "err");
    } finally {
      setSnapshotting(false);
    }
  };

  const doDataRefresh = async () => {
    setDataRefreshing(true);
    log("Mise a jour complete serveur...", "info");
    try {
      const result = await api.runDataRefresh("full");
      await loadStatus();
      if (result.refreshed) {
        log(`MAJ OK: ${result.upcoming_seen || 0} matchs, ${result.odds_saved || 0} lignes cotes, ${result.contexts_warmed || 0} contextes IA`, "ok");
      } else {
        log(result.message || "Mise a jour non effectuee", "info");
      }
    } catch (e: any) {
      log("Erreur MAJ complete: " + e.message, "err");
    } finally {
      setDataRefreshing(false);
    }
  };

  const fmtCountdown = (s: number) => `${Math.floor(s / 60)}m${(s % 60).toString().padStart(2, "0")}s`;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Configuration & Données</h1>
        <p className="text-gray-500 text-sm mt-1">Importe des compétitions, rafraîchis les cotes, gère les mises à jour automatiques</p>
      </div>

      {/* Statut système */}
      {status && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { icon: <Database size={16} />, label: "Événements", value: status.events_total },
            { icon: <Zap size={16} />, label: "Prédictions", value: status.predictions_computed },
            { icon: <CheckCircle size={16} />, label: "Snapshots cotes", value: status.odds_snapshots },
            { icon: <RefreshCw size={16} />, label: "Compétitions", value: status.competitions_active },
          ].map(({ icon, label, value }) => (
            <div key={label} className="card flex items-center gap-3">
              <div className="text-blue-400">{icon}</div>
              <div>
                <div className="text-xl font-bold text-white">{value}</div>
                <div className="text-xs text-gray-500">{label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actions rapides */}
      <div className="card">
        <h2 className="font-semibold text-white mb-4">Actions rapides</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button onClick={doDataRefresh} disabled={dataRefreshing} className="btn-primary flex items-center justify-center gap-2 py-3">
            {dataRefreshing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Mise a jour complete
          </button>
          <button onClick={doRefreshOdds} disabled={refreshingOdds} className="btn-secondary flex items-center justify-center gap-2 py-3">
            {refreshingOdds ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Rafraîchir les cotes bookmakers
          </button>
          <button onClick={doRunPredictions} disabled={runningPreds} className="btn-primary flex items-center justify-center gap-2 py-3">
            {runningPreds ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            Calculer toutes les prédictions
          </button>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <h2 className="font-semibold text-white mb-1 flex items-center gap-2">
              <Database size={16} className="text-blue-400" />
              Historique durable / backtesting
            </h2>
            <p className="text-gray-500 text-xs">
              Stocke les snapshots de predictions, cotes et value bets pour mesurer ROI, yield, Brier Score et CLV.
            </p>
          </div>
          <span className={clsx(
            "text-xs px-3 py-1 rounded-full border self-start",
            historyStatus?.enabled
              ? "border-green-800 bg-green-900/30 text-green-400"
              : "border-yellow-800 bg-yellow-900/30 text-yellow-400"
          )}>
            {historyStatus?.enabled ? "D1 actif" : "D1 non configure"}
          </span>
        </div>

        {historyStatus?.enabled ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
            <MiniStat label="Matchs stockes" value={historyStatus.events_total || 0} />
            <MiniStat label="Predictions" value={historyStatus.prediction_snapshots || 0} />
            <MiniStat label="Lignes cotes" value={historyStatus.odds_price_snapshots || 0} />
            <MiniStat label="Value bets" value={historyStatus.value_bet_snapshots || 0} />
            <MiniStat label="Snapshots joueurs" value={historyStatus.player_projection_snapshots || 0} />
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-yellow-900/50 bg-yellow-950/20 p-3 text-sm text-yellow-300">
            {historyStatus?.message || "Le code est pret. Il manque seulement le binding Cloudflare D1 SPORTSBET_DB."}
          </div>
        )}

        {historyStatus?.latest_refresh && (
          <p className="text-xs text-gray-500 mt-3">
            Dernier snapshot: {historyStatus.latest_refresh.status} - {new Date(historyStatus.latest_refresh.started_at).toLocaleString("fr-FR")}
          </p>
        )}

        <button
          onClick={doCreateSnapshot}
          disabled={snapshotting}
          className="btn-secondary flex items-center justify-center gap-2 py-3 mt-4 w-full md:w-auto"
        >
          {snapshotting ? <Loader2 size={15} className="animate-spin" /> : <Database size={15} />}
          Creer un snapshot historique
        </button>
      </div>

      {/* Import compétitions */}
      <div className="card">
        <h2 className="font-semibold text-white mb-1">Importer une compétition</h2>
        <p className="text-gray-500 text-xs mb-4">Importe les matchs et résultats depuis Football-Data.org pour entraîner les modèles.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {AVAILABLE_COMPS.map(({ code, name, flag }) => (
            <button
              key={code}
              onClick={() => importComp(code)}
              disabled={!!importing}
              className={clsx(
                "flex items-center justify-between p-3 rounded-xl border transition-colors text-left",
                importing === code
                  ? "border-blue-700 bg-blue-900/20"
                  : "border-gray-700 bg-gray-800/50 hover:border-gray-600 hover:bg-gray-800"
              )}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{flag}</span>
                <div>
                  <div className="text-sm font-semibold text-white">{name}</div>
                  <div className="text-xs text-gray-500">{code}</div>
                </div>
              </div>
              {importing === code
                ? <Loader2 size={16} className="animate-spin text-blue-400" />
                : <Download size={16} className="text-gray-500" />}
            </button>
          ))}
        </div>
      </div>

      {/* Mise à jour automatique */}
      <div className="card">
        <h2 className="font-semibold text-white mb-1 flex items-center gap-2">
          <Clock size={16} className="text-blue-400" />
          Mise à jour automatique
        </h2>
        <p className="text-gray-500 text-xs mb-4">Rafraîchit les cotes et recalcule les prédictions automatiquement.</p>

        {historyStatus?.latest_automation && (
          <div className="mb-4 rounded-xl border border-gray-800 bg-gray-900/60 p-3 text-xs text-gray-400">
            <div className="font-semibold text-gray-300 mb-1">Derniere mise a jour serveur</div>
            <div>
              Statut: {historyStatus.latest_automation.status} - Mode: {historyStatus.latest_automation.mode} - Declenchement: {historyStatus.latest_automation.trigger}
            </div>
            <div>
              {new Date(historyStatus.latest_automation.started_at).toLocaleString("fr-FR")} - {historyStatus.latest_automation.upcoming_seen} matchs a venir - {historyStatus.latest_automation.odds_saved} lignes cotes - {historyStatus.latest_automation.contexts_warmed} contextes IA
            </div>
          </div>
        )}

        <div className="flex items-center gap-4 flex-wrap">
          <div
            onClick={() => setAutoRefresh(x => !x)}
            className={clsx(
              "w-12 h-6 rounded-full transition-colors relative cursor-pointer flex-shrink-0",
              autoRefresh ? "bg-green-500" : "bg-gray-700"
            )}
          >
            <div className={clsx(
              "absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform",
              autoRefresh ? "translate-x-6" : "translate-x-0.5"
            )} />
          </div>
          <span className="text-sm text-white">{autoRefresh ? "Activé" : "Désactivé"}</span>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Toutes les</span>
            <select
              value={autoInterval}
              onChange={e => setAutoInterval(Number(e.target.value))}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white outline-none"
            >
              <option value={30}>30 min</option>
              <option value={60}>1 heure</option>
              <option value={120}>2 heures</option>
              <option value={360}>6 heures</option>
            </select>
          </div>

          {autoRefresh && countdown > 0 && (
            <span className="text-xs text-green-400 bg-green-900/30 px-3 py-1 rounded-full">
              Prochaine MàJ dans {fmtCountdown(countdown)}
            </span>
          )}
        </div>
      </div>

      {/* Journal */}
      {messages.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-gray-400 text-sm">Journal des actions</h2>
            <button onClick={() => setMessages([])} className="text-xs text-gray-600 hover:text-gray-400">Effacer</button>
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {messages.map((m, i) => (
              <div key={i} className={clsx(
                "text-xs px-2 py-1 rounded",
                m.type === "ok" ? "text-green-400 bg-green-900/20"
                : m.type === "err" ? "text-red-400 bg-red-900/20"
                : "text-gray-400 bg-gray-800/40"
              )}>{m.text}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-800/70 rounded-xl p-3 border border-gray-700">
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
