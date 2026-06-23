"use client";
import { useEffect, useState } from "react";
import { api, type BankrollData } from "@/lib/api";
import { DollarSign, TrendingUp, TrendingDown, AlertTriangle, Loader2 } from "lucide-react";
import { clsx } from "clsx";

export default function BankrollPage() {
  const [bk, setBk] = useState<BankrollData | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [initial, setInitial] = useState(500);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getBankroll();
      if ((data as any).message) setBk(null);
      else setBk(data as BankrollData);
    } finally {
      setLoading(false);
    }
  };

  const create = async () => {
    setCreating(true);
    try {
      await api.createBankroll({ initial_amount: initial });
      await load();
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-gray-500" size={32} />
    </div>
  );

  if (!bk) return (
    <div className="max-w-md space-y-6">
      <h1 className="text-2xl font-bold text-white flex items-center gap-2">
        <DollarSign size={24} className="text-green-400" />
        Bankroll
      </h1>
      <div className="card space-y-4">
        <p className="text-gray-400 text-sm">Configurez votre bankroll de départ pour activer le suivi et les recommandations de mises.</p>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Montant initial (€)</label>
          <input type="number" min={10} value={initial} onChange={(e) => setInitial(Number(e.target.value))}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white" />
        </div>
        <button onClick={create} disabled={creating} className="btn-primary w-full">
          {creating ? "Création..." : "Créer ma bankroll"}
        </button>
        <p className="text-xs text-gray-600">
          ⚠️ Ne misez jamais plus que ce que vous pouvez vous permettre de perdre.
        </p>
      </div>
    </div>
  );

  const pl = bk.profit_loss;
  const drawdownPct = (bk.drawdown * 100).toFixed(1);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white flex items-center gap-2">
        <DollarSign size={24} className="text-green-400" />
        Bankroll
      </h1>

      {/* Alertes */}
      {bk.alerts.map((alert, i) => (
        <div key={i} className="card border-red-800 bg-red-900/20 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-400">{alert}</p>
        </div>
      ))}

      {/* Stats principales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Bankroll actuelle" value={`${bk.current_amount.toFixed(2)} ${bk.currency}`}
          sub={`Initial : ${bk.initial_amount} ${bk.currency}`} />
        <StatCard label="P&L total"
          value={`${pl >= 0 ? "+" : ""}${pl.toFixed(2)} ${bk.currency}`}
          className={pl >= 0 ? "text-green-400" : "text-red-400"} />
        <StatCard label="ROI" value={`${bk.roi_pct >= 0 ? "+" : ""}${bk.roi_pct.toFixed(1)}%`}
          className={bk.roi_pct >= 0 ? "text-green-400" : "text-red-400"} />
        <StatCard label="Win Rate"
          value={`${(bk.win_rate * 100).toFixed(0)}%`}
          sub={`${bk.total_bets} paris réglés`} />
      </div>

      {/* Gestion du risque */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-gray-300">Gestion du risque</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-xs text-gray-400">Mise maximum recommandée</div>
            <div className="text-xl font-bold text-white mt-1">
              {bk.max_stake_amount.toFixed(2)} {bk.currency}
            </div>
            <div className="text-xs text-gray-500">{(bk.max_stake_pct * 100).toFixed(1)}% de la bankroll</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-xs text-gray-400">Drawdown actuel</div>
            <div className={clsx("text-xl font-bold mt-1", bk.drawdown > 0.1 ? "text-red-400" : "text-white")}>
              -{drawdownPct}%
            </div>
            <div className="text-xs text-gray-500">Stop-loss à -{(bk.stop_loss_pct || 0.2) * 100}%</div>
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-600">
        ⚠️ Ces recommandations sont basées sur des probabilités. Aucun gain n'est garanti dans les paris sportifs.
      </p>
    </div>
  );
}

function StatCard({ label, value, sub, className = "" }: {
  label: string; value: string; sub?: string; className?: string;
}) {
  return (
    <div className="card">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={clsx("text-2xl font-bold mt-1", className || "text-white")}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}
