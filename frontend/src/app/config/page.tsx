"use client";
import { useEffect, useState } from "react";
import { api, type SystemStatus, type Competition } from "@/lib/api";
import { Settings, Download, RefreshCw, Cpu, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { clsx } from "clsx";

export default function ConfigPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const load = async () => {
    try {
      const [s, c] = await Promise.all([api.getStatus(), api.getCompetitions()]);
      setStatus(s);
      setCompetitions(c);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const importComp = async (code: string) => {
    setImporting(code);
    try {
      await api.importCompetition(code);
      setTimeout(load, 2000);
    } finally {
      setImporting(null);
    }
  };

  const runPredictions = async () => {
    setRunning("predict");
    try { await api.runPredictions(); setTimeout(load, 3000); }
    finally { setRunning(null); }
  };

  const refreshOdds = async () => {
    setRunning("odds");
    try { await api.refreshOdds(); setTimeout(load, 2000); }
    finally { setRunning(null); }
  };

  const PRIORITY_COMPS = ["WC", "EC", "CL", "FL1", "PL", "BL1", "SA", "PD"];

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-white flex items-center gap-2">
        <Settings size={24} className="text-green-400" />
        Configuration
      </h1>

      {/* Status */}
      {status && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-gray-300 flex items-center gap-2">
            <Cpu size={16} /> Statut système
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <Stat label="Matchs en base" value={status.events_total} />
            <Stat label="Matchs à venir" value={status.events_scheduled} />
            <Stat label="Prédictions" value={status.predictions_computed} />
            <Stat label="Snapshots cotes" value={status.odds_snapshots} />
            <Stat label="Compétitions actives" value={status.competitions_active} />
            {status.odds_api_quota.remaining && (
              <Stat label="Quota Odds API restant" value={status.odds_api_quota.remaining} />
            )}
          </div>
        </div>
      )}

      {/* Actions rapides */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-gray-300">Actions</h2>
        <div className="flex gap-3 flex-wrap">
          <button onClick={runPredictions} disabled={running === "predict"}
            className="btn-primary flex items-center gap-2 text-sm">
            {running === "predict" ? <Loader2 size={14} className="animate-spin" /> : <Cpu size={14} />}
            Calculer toutes les prédictions
          </button>
          <button onClick={refreshOdds} disabled={running === "odds"}
            className="btn-secondary flex items-center gap-2 text-sm">
            {running === "odds" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Rafraîchir les cotes
          </button>
        </div>
      </div>

      {/* Import compétitions */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-gray-300 flex items-center gap-2">
          <Download size={16} /> Importer des données
        </h2>
        <p className="text-xs text-gray-400">
          Importe les matchs et résultats historiques depuis Football-Data.org.
          Nécessite une clé API gratuite.
        </p>
        <div className="space-y-2">
          {PRIORITY_COMPS.map((code) => {
            const comp = competitions.find((c) => c.code === code);
            if (!comp) return null;
            return (
              <div key={code} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
                <div>
                  <div className="font-medium text-white text-sm">{comp.name}</div>
                  <div className="text-xs text-gray-500">{comp.country} · {code}</div>
                </div>
                <button
                  onClick={() => importComp(code)}
                  disabled={importing === code}
                  className="btn-secondary text-xs flex items-center gap-1"
                >
                  {importing === code ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                  Importer
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Instructions */}
      <div className="card space-y-3 border-gray-700">
        <h2 className="font-semibold text-gray-300">Démarrage rapide</h2>
        <ol className="space-y-2 text-sm text-gray-400 list-decimal list-inside">
          <li>Copiez <code className="text-green-400">.env.example</code> en <code className="text-green-400">.env</code></li>
          <li>Ajoutez votre clé Football-Data.org (gratuite sur football-data.org)</li>
          <li>Ajoutez votre clé The Odds API (500 req/mois gratuit)</li>
          <li>Importez la Coupe du Monde : cliquez sur WC ci-dessus</li>
          <li>Cliquez "Calculer toutes les prédictions"</li>
          <li>Consultez les Value Bets dans le menu de gauche</li>
        </ol>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-gray-800 rounded-lg p-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-xl font-bold text-white mt-1">{value}</div>
    </div>
  );
}
