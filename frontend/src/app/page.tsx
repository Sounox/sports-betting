"use client";
import { useEffect, useState } from "react";
import { api, type Event } from "@/lib/api";
import { MatchCard } from "@/components/MatchCard";
import { DataFreshnessCard } from "@/components/DataFreshnessCard";
import { RefreshCw, Calendar } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export default function HomePage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getUpcoming(48);
      setEvents(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const today = format(new Date(), "EEEE d MMMM yyyy", { locale: fr });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Calendar size={24} className="text-green-400" />
            Matchs à venir
          </h1>
          <p className="text-gray-400 text-sm mt-1 capitalize">{today}</p>
        </div>
        <button onClick={load} className="btn-secondary flex items-center gap-2 text-sm">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Actualiser
        </button>
      </div>

      <DataFreshnessCard compact onAfterRefresh={load} />

      {error && (
        <div className="card border-red-800 bg-red-900/20 text-red-400 text-sm">
          Erreur : {error}. Vérifiez que le backend est démarré.
        </div>
      )}

      {loading && (
        <div className="grid gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card animate-pulse h-24 bg-gray-800" />
          ))}
        </div>
      )}

      {!loading && events.length === 0 && !error && (
        <div className="card text-center text-gray-500 py-12">
          <p className="text-lg">Aucun match disponible</p>
          <p className="text-sm mt-2">Importez une compétition depuis la page Configuration</p>
        </div>
      )}

      {!loading && events.length > 0 && (
        <>
          <p className="text-gray-500 text-sm">{events.length} match(s) trouvé(s)</p>
          <div className="grid gap-3">
            {events.map((event) => (
              <MatchCard key={event.id} event={event} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
