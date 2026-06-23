"use client";
import { useEffect, useState, useRef } from "react";
import { api, type SystemStatus } from "@/lib/api";
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
  const [importing, setImporting] = useState<string | null>(null);
  const [refreshingOdds, setRefreshingOdds] = useState(false);
  const [runningPreds, setRunningPreds] = useState(false);
  const [messages, setMessages] = useState<{ text: string; type: "ok" | "err" | "info" }[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [autoInterval, setAutoInterval] = useState(60);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [countdown, setCountdown] = useState(0);

  const log = (text: string, type: "ok" | "err" | "info" = "info") =>
    setMessages(m => [{ text, type }, ...m].slice(0, 20));

  const loadStatus = async () => {
    try { setStatus(await api.getStatus()); } catch {}
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
      await api.refreshOdds();
      await api.runPredictions();
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
