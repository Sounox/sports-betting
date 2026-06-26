"use client";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  api,
  type BetSuggestion,
  type Event,
  type MatchBetBuilder,
  type MatchContext,
  type MatchParlayResponse,
  type MatchParlayRiskProfile,
  type EventOddsHistoryResponse,
  type MarketSignal,
  type MatchMarketCatalogEntry,
  type OddsMovement,
  type PlayerInsights,
} from "@/lib/api";
import { AlertTriangle, Loader2, RefreshCw, TrendingUp, Calculator, Target, BarChart2, ChevronDown, ChevronUp, Users, Sparkles, ExternalLink, ShieldCheck, Gauge, Activity } from "lucide-react";
import { clsx } from "clsx";

export default function AnalysePage() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [predicting, setPredicting] = useState(false);
  const [playerInsights, setPlayerInsights] = useState<PlayerInsights | null>(null);
  const [matchContext, setMatchContext] = useState<MatchContext | null>(null);
  const [betBuilder, setBetBuilder] = useState<MatchBetBuilder | null>(null);
  const [oddsHistory, setOddsHistory] = useState<EventOddsHistoryResponse | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try { setEvent(await api.getEvent(Number(id))); }
    finally { setLoading(false); }
  };

  const runPrediction = async () => {
    setPredicting(true);
    try { await api.predictEvent(Number(id)); await load(); }
    finally { setPredicting(false); }
  };

  useEffect(() => {
    load();
    setInsightsLoading(true);
    Promise.allSettled([
      api.getPlayerInsights(Number(id)),
      api.getMatchContext(Number(id)),
      api.getMatchBetBuilder(Number(id)),
      api.getEventOddsHistory(Number(id)),
    ]).then(([playersResult, contextResult, builderResult, oddsHistoryResult]) => {
      if (playersResult.status === "fulfilled") {
        setPlayerInsights(playersResult.value);
      }
      if (contextResult.status === "fulfilled") {
        setMatchContext(contextResult.value);
      }
      if (builderResult.status === "fulfilled") {
        setBetBuilder(builderResult.value);
      }
      if (oddsHistoryResult.status === "fulfilled") {
        setOddsHistory(oddsHistoryResult.value);
      }
      setInsightsLoading(false);
    });
  }, [id]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-gray-500" size={32} /></div>;
  if (!event) return <div className="card text-gray-500">Événement non trouvé</div>;

  const pred = event.prediction;
  const markets = pred?.markets;
  const ou = markets?.over_under;
  const btts = markets?.btts;
  const lambda = markets?.lambda;

  return (
    <div className="mx-auto max-w-7xl space-y-4 sm:space-y-5">
      {/* Header match */}
      <div className="card">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">{event.competition}</span>
            {event.stage && <span className="text-xs text-gray-600">{event.stage}</span>}
          </div>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <span className={clsx("text-xs px-2 py-0.5 rounded-full", statusColor(event.status))}>{event.status}</span>
            <button onClick={runPrediction} disabled={predicting} className="btn-secondary flex items-center gap-2 text-sm">
              {predicting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {pred ? "Recalculer" : "Calculer"}
            </button>
          </div>
        </div>

        {/* Score central */}
        <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-3 sm:items-center sm:gap-4">
          <div className={clsx("rounded-2xl p-3 text-center sm:p-4", pred?.prob_home && pred.prob_home > (pred?.prob_away ?? 0) ? "bg-green-900/30 border border-green-800/50" : "bg-gray-800/50")}>
            <div className="text-lg font-bold text-white sm:text-xl">{event.home_team}</div>
            {pred && <div className="mt-1 text-3xl font-black text-white sm:mt-2 sm:text-4xl">{(pred.prob_home! * 100).toFixed(0)}%</div>}
            <div className="text-xs text-gray-500 mt-1">Victoire domicile</div>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-950/35 p-3 text-center sm:border-0 sm:bg-transparent sm:p-0">
            <div className="text-gray-400 text-sm font-semibold">VS</div>
            {pred && <div className="text-2xl font-black text-gray-300 mt-1">{(pred.prob_draw! * 100).toFixed(0)}%</div>}
            <div className="text-xs text-gray-500">Match nul</div>
            {lambda && (
              <div className="mt-3 bg-gray-800 rounded-xl px-3 py-2">
                <div className="text-xs text-gray-500">Buts attendus</div>
                <div className="text-lg font-bold text-orange-400">{(lambda.home + lambda.away).toFixed(1)}</div>
                <div className="text-xs text-gray-500">{lambda.home.toFixed(1)} – {lambda.away.toFixed(1)}</div>
              </div>
            )}
          </div>
          <div className={clsx("rounded-2xl p-3 text-center sm:p-4", pred?.prob_away && pred.prob_away > (pred?.prob_home ?? 0) ? "bg-blue-900/30 border border-blue-800/50" : "bg-gray-800/50")}>
            <div className="text-lg font-bold text-white sm:text-xl">{event.away_team}</div>
            {pred && <div className="mt-1 text-3xl font-black text-white sm:mt-2 sm:text-4xl">{(pred.prob_away! * 100).toFixed(0)}%</div>}
            <div className="text-xs text-gray-500 mt-1">Victoire extérieur</div>
          </div>
        </div>

        {/* Badges */}
        {pred && (
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <ConfBadge c={pred.confidence} />
            <QualBadge q={pred.data_quality} />
            {pred.warning_flags?.map((w, i) => (
              <span key={i} className="flex items-center gap-1 text-xs text-yellow-400 bg-yellow-900/20 px-2 py-0.5 rounded-full">
                <AlertTriangle size={10} />{w.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Stats marchés */}
      {pred && (
        <MatchCommandCenter
          event={event}
          builder={betBuilder}
          context={matchContext}
          history={oddsHistory}
          insights={playerInsights}
        />
      )}

      {markets && (
        <ProgressiveSection
          title="Marches detailles"
          subtitle="Over/under, BTTS, mi-temps et scores exacts restent disponibles sans charger l'ecran."
          icon={<BarChart2 size={16} className="text-orange-300" />}
        >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
          {/* Over / Under */}
          {ou && (
            <div className="card">
              <h3 className="font-semibold text-gray-300 mb-3 text-sm flex items-center gap-2"><BarChart2 size={14} />Over / Under</h3>
              <div className="space-y-2">
                {[
                  { label: "Over 0.5", v: ou.over_0_5 },
                  { label: "Over 1.5", v: ou.over_1_5 },
                  { label: "Over 2.5", v: ou.over_2_5 },
                  { label: "Over 3.5", v: ou.over_3_5 },
                  { label: "Under 2.5", v: ou.under_2_5 },
                ].filter(x => x.v != null).map(({ label, v }) => (
                  <div key={label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-400">{label}</span>
                      <span className="font-bold text-white">{(v * 100).toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className={clsx("h-full rounded-full", v > 0.5 ? "bg-orange-500" : "bg-gray-600")} style={{ width: `${v * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* BTTS + mi-temps */}
          <div className="card space-y-4">
            {btts && (
              <div>
                <h3 className="font-semibold text-gray-300 mb-3 text-sm">Les 2 équipes marquent</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className={clsx("rounded-xl p-3 text-center", btts.yes > 0.5 ? "bg-purple-900/40 border border-purple-800/50" : "bg-gray-800")}>
                    <div className="text-xs text-gray-400">Oui</div>
                    <div className="text-xl font-black text-white">{(btts.yes * 100).toFixed(0)}%</div>
                  </div>
                  <div className="bg-gray-800 rounded-xl p-3 text-center">
                    <div className="text-xs text-gray-400">Non</div>
                    <div className="text-xl font-black text-white">{(btts.no * 100).toFixed(0)}%</div>
                  </div>
                </div>
              </div>
            )}
            {markets["half_time"] && (
              <div>
                <h3 className="font-semibold text-gray-300 mb-2 text-sm">Mi-temps</h3>
                <div className="space-y-1">
                  {[
                    { label: event.home_team, v: markets["half_time"].home },
                    { label: "Nul", v: markets["half_time"].draw },
                    { label: event.away_team, v: markets["half_time"].away },
                  ].map(({ label, v }) => (
                    <div key={label} className="flex justify-between text-xs">
                      <span className="text-gray-400 truncate">{label}</span>
                      <span className="font-bold text-white">{(v * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Scores probables */}
          {markets.top_scores && (
            <div className="card">
              <h3 className="font-semibold text-gray-300 mb-3 text-sm">Scores les plus probables</h3>
              <div className="space-y-1.5">
                {markets.top_scores.slice(0, 8).map((s: any, i: number) => (
                  <div key={i} className={clsx("flex items-center justify-between rounded-lg px-3 py-1.5", i === 0 ? "bg-green-900/40 border border-green-800/50" : "bg-gray-800/60")}>
                    <span className={clsx("font-bold", i === 0 ? "text-green-400" : "text-white")}>{s.score}</span>
                    <span className="text-xs text-gray-400">{((s.probability ?? s.prob ?? 0) * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        </ProgressiveSection>
      )}

      {insightsLoading && (
        <div className="card flex items-center gap-3 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin text-blue-400" />
          Mise à jour des données joueurs et du contexte sourcé...
        </div>
      )}

      {matchContext && <ContextPanel context={matchContext} />}

      {betBuilder && (
        <>
          <SameMatchParlayPanel eventId={Number(id)} />
          {oddsHistory && <OddsHistoryPanel history={oddsHistory} />}
          <BetSuggestionsPanel eventId={Number(id)} builder={betBuilder} />
        </>
      )}

      {playerInsights && <PlayerInsightsPanel insights={playerInsights} />}

      {/* Calculateur de paris */}
      {pred && <BetCalculator event={event} pred={pred} />}

      {/* Value bets */}
      {pred?.value_bets && pred.value_bets.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-green-400 mb-3 flex items-center gap-2">
            <TrendingUp size={16} />Value Bets détectées
          </h3>
          <div className="space-y-2">
            {pred.value_bets.map((vb: any, i: number) => (
              <div key={i} className="flex flex-col gap-3 rounded-xl bg-gray-800 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white">{vb.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    Modèle : <span className="text-white">{(vb.model_prob * 100).toFixed(0)}%</span>
                    {" "}· Marché : <span className="text-white">{(vb.fair_prob * 100).toFixed(0)}%</span>
                    {" "}· {vb.bookmaker}
                  </div>
                </div>
                <div className="shrink-0 sm:text-right">
                  <div className="text-xl font-black text-white sm:text-2xl">Cote {Number(vb.odds).toFixed(2)}</div>
                  <div className="text-xs text-green-400 font-bold">+{(vb.edge * 100).toFixed(1)}% edge</div>
                  <div className="text-xs text-yellow-400">Kelly {(vb.kelly_stake_pct * 100).toFixed(1)}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Calculateur de paris ───────────────────────────────────────── */
function pct(value?: number | null, digits = 1) {
  if (value == null || Number.isNaN(value)) return "n/a";
  return `${(value * 100).toFixed(digits)}%`;
}

function bestOutcome(event: Event) {
  const pred = event.prediction;
  if (!pred) return null;
  return [
    { label: event.home_team, key: "Domicile", probability: pred.prob_home },
    { label: "Match nul", key: "Nul", probability: pred.prob_draw },
    { label: event.away_team, key: "Exterieur", probability: pred.prob_away },
  ].sort((a, b) => b.probability - a.probability)[0];
}

function topPlayableSuggestions(builder?: MatchBetBuilder | null) {
  if (!builder) return [];
  return [...builder.suggestions]
    .filter((suggestion) => {
      if (suggestion.category === "Score exact") return false;
      if (suggestion.data_level === "proxy") return false;
      if (suggestion.playability === "eviter") return false;
      if ((suggestion.reliability_score ?? 0) < 55) return false;
      if (suggestion.offered_odds && (suggestion.edge || 0) > 0) return true;
      return suggestion.source === "model" && suggestion.probability >= 0.52;
    })
    .sort((a, b) => {
      const reliabilityDelta = (b.reliability_score || 0) - (a.reliability_score || 0);
      if (Math.abs(reliabilityDelta) > 5) return reliabilityDelta;
      const edgeDelta = (b.edge || 0) - (a.edge || 0);
      if (Math.abs(edgeDelta) > 0.005) return edgeDelta;
      return b.probability - a.probability;
    })
    .slice(0, 5);
}

function topPlayerHighlights(insights?: PlayerInsights | null) {
  return (insights?.players || [])
    .filter(
      (player) =>
        player.anytime_scorer_probability > 0.08 ||
        player.assist_probability > 0.08 ||
        player.shot_on_target_probability > 0.18,
    )
    .sort(
      (a, b) =>
        b.anytime_scorer_probability +
        b.assist_probability -
        (a.anytime_scorer_probability + a.assist_probability),
    )
    .slice(0, 4);
}

function topOddsMoves(history?: EventOddsHistoryResponse | null) {
  return (history?.movements || [])
    .slice()
    .sort((a, b) => {
      const playerA = a.market.startsWith("player_") ? 0.04 : 0;
      const playerB = b.market.startsWith("player_") ? 0.04 : 0;
      return Math.abs(b.implied_prob_delta || b.price_delta_pct || 0) + playerB -
        (Math.abs(a.implied_prob_delta || a.price_delta_pct || 0) + playerA);
    })
    .slice(0, 4);
}

function MatchCommandCenter({
  event,
  builder,
  context,
  history,
  insights,
}: {
  event: Event;
  builder: MatchBetBuilder | null;
  context: MatchContext | null;
  history: EventOddsHistoryResponse | null;
  insights: PlayerInsights | null;
}) {
  const pred = event.prediction;
  if (!pred) return null;
  const markets = pred.markets || {};
  const favorite = bestOutcome(event);
  const playable = topPlayableSuggestions(builder);
  const playerHighlights = topPlayerHighlights(insights);
  const marketMoves = topOddsMoves(history);
  const topScore = markets.top_scores?.[0];
  const bttsYes = markets.btts?.yes;
  const over25 = markets.over_under?.over_2_5;
  const totalGoals =
    markets.lambda?.home != null && markets.lambda?.away != null
      ? Number(markets.lambda.home) + Number(markets.lambda.away)
      : null;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_0.85fr] gap-4">
      <div className="card overflow-hidden border-emerald-900/40 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_32%),rgba(17,24,39,0.85)]">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-300">
              <Gauge size={14} />
              Lecture rapide du match
            </div>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
              {favorite ? `${favorite.label} en tete du modele` : "Analyse probabiliste"}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-400">
              Synthese lisible des probabilites, du contexte IA, des cotes et des donnees joueurs. Rien ici ne garantit un resultat: le role de l'outil est de filtrer le risque.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 lg:min-w-[330px]">
            <Stat label={event.home_team} value={pct(pred.prob_home, 0)} highlight={favorite?.key === "Domicile" ? "green" : undefined} />
            <Stat label="Nul" value={pct(pred.prob_draw, 0)} />
            <Stat label={event.away_team} value={pct(pred.prob_away, 0)} highlight={favorite?.key === "Exterieur" ? "green" : undefined} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-4 gap-3">
          <DecisionTile
            label="Favori modele"
            value={favorite?.label || "n/a"}
            detail={favorite ? `${pct(favorite.probability)} de probabilite` : "Prediction indisponible"}
          />
          <DecisionTile
            label="Total attendu"
            value={totalGoals == null ? "n/a" : totalGoals.toFixed(2)}
            detail={over25 == null ? "Over 2.5 non calcule" : `Over 2.5 a ${pct(over25)}`}
          />
          <DecisionTile
            label="BTTS"
            value={bttsYes == null ? "n/a" : pct(bttsYes, 0)}
            detail={bttsYes == null ? "Non calcule" : bttsYes >= 0.52 ? "Scenario ouvert" : "Scenario plus ferme"}
          />
          <DecisionTile
            label="Score modal"
            value={topScore?.score || "n/a"}
            detail={topScore ? `${pct(topScore.probability ?? topScore.prob)} du modele` : "Score exact non calcule"}
          />
        </div>

        {context && (
          <div className="mt-4 rounded-xl border border-cyan-900/40 bg-cyan-950/15 p-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-cyan-300">
              <Sparkles size={13} />
              Contexte IA
            </div>
            <p className="mt-2 text-sm text-gray-300 line-clamp-3">{context.summary}</p>
          </div>
        )}
      </div>

      <div className="card space-y-3 border-green-900/40 bg-green-950/10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-white flex items-center gap-2">
              <ShieldCheck size={16} className="text-green-400" />
              Paris les plus propres
            </h3>
            <p className="text-xs text-gray-500 mt-1">Selectionne par edge, cote et risque.</p>
          </div>
          <span className="rounded-full bg-gray-800 px-2 py-1 text-[11px] text-gray-400">
            {playable.length} idee(s)
          </span>
        </div>

        {playable.length === 0 ? (
          <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 text-sm text-gray-500">
            Aucun pari assez propre pour etre mis en avant. Le match reste analysable, mais pas force.
          </div>
        ) : (
          <div className="space-y-2">
            {playable.map((suggestion) => (
              <QuickPick key={suggestion.id} suggestion={suggestion} />
            ))}
          </div>
        )}
      </div>

      <SideInsight title="Joueurs a surveiller" icon={<Users size={15} className="text-emerald-300" />}>
        {playerHighlights.length ? (
          playerHighlights.map((player) => (
            <div key={player.player_id} className="rounded-xl bg-gray-900/75 border border-gray-800 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-white text-sm">{player.player}</div>
                  <div className="text-xs text-gray-500">{player.team} - {player.position}</div>
                </div>
                <span className="text-xs font-bold text-green-300">{pct(player.anytime_scorer_probability)}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Stat label="Buteur" value={pct(player.anytime_scorer_probability)} />
                <Stat label="But/Passe" value={pct(player.goal_or_assist_probability || player.assist_probability)} />
                <Stat label="Tir cadre" value={pct(player.shot_on_target_probability)} />
              </div>
            </div>
          ))
        ) : (
          <EmptyMini text="Pas encore assez de donnees joueurs fiables." />
        )}
      </SideInsight>

      <SideInsight title="Marche en mouvement" icon={<Activity size={15} className="text-indigo-300" />}>
        {marketMoves.length ? (
          marketMoves.map((movement) => (
            <div key={`${movement.market}:${movement.bookmaker}:${movement.selection}:${movement.point ?? ""}`} className="rounded-xl bg-gray-900/75 border border-gray-800 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-gray-500">{movement.market_label}</div>
                  <div className="font-semibold text-white text-sm truncate">{movement.selection}</div>
                  <div className="text-xs text-gray-600">{movement.bookmaker}</div>
                </div>
                <MarketDirectionPill movement={movement} />
              </div>
              <div className="mt-2 text-xs text-gray-500">
                {formatOdds(movement.opening_price)} {"->"} {formatOdds(movement.latest_price)} - {movement.observations} obs.
              </div>
            </div>
          ))
        ) : (
          <EmptyMini text="Les prochains refreshs rempliront les mouvements." />
        )}
      </SideInsight>
    </div>
  );
}

function DecisionTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-3">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-black text-white truncate">{value}</div>
      <div className="mt-1 text-xs text-gray-500">{detail}</div>
    </div>
  );
}

function QuickPick({ suggestion }: { suggestion: BetSuggestion }) {
  const playable = suggestion.source === "bookmaker" && suggestion.offered_odds;
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-white text-sm truncate">{suggestion.label}</div>
          <div className="text-xs text-gray-500 mt-0.5">{suggestion.category} - {suggestion.risk_level}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-black text-green-300">{formatOdds(playable ? suggestion.offered_odds : suggestion.fair_odds)}</div>
          <div className="text-[11px] text-gray-500">{pct(suggestion.probability)}</div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {suggestion.edge != null && (
          <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-bold", suggestion.edge > 0 ? "bg-green-900/40 text-green-300" : "bg-red-900/40 text-red-300")}>
            Edge {suggestion.edge > 0 ? "+" : ""}{pct(suggestion.edge)}
          </span>
        )}
        {suggestion.market_signal && <MarketSignalBadge signal={suggestion.market_signal} />}
      </div>
    </div>
  );
}

function SideInsight({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-white flex items-center gap-2">
        {icon}
        {title}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-2">
        {children}
      </div>
    </div>
  );
}

function EmptyMini({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 text-sm text-gray-500">
      {text}
    </div>
  );
}

function MarketDirectionPill({ movement }: { movement: OddsMovement }) {
  const copy = movementCopy(movement);
  return (
    <span className={clsx("shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold", copy.className)}>
      {copy.label}
    </span>
  );
}

function ProgressiveSection({
  title,
  subtitle,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="card group" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-2">
            {icon}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-white">{title}</h3>
            <p className="mt-1 line-clamp-2 text-xs text-gray-500">{subtitle}</p>
          </div>
        </div>
        <ChevronDown size={17} className="shrink-0 text-gray-500 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

function formatOdds(value?: number) {
  if (!value) return "Cote modele";
  return `Cote ${value.toFixed(2)}`;
}

function displayedOdds(suggestion: BetSuggestion) {
  return suggestion.offered_odds || suggestion.fair_odds;
}

function formatCurrencyEUR(value: number) {
  return `${value.toFixed(2)} EUR`;
}

function boundedProbability(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0.01, Math.min(0.99, value));
}

function isFrenchBookmakerName(bookmaker?: string) {
  if (!bookmaker) return false;
  return /(winamax|betclic|unibet \(fr\)|pmu|parions)/i.test(bookmaker);
}

function isFrenchSuggestion(suggestion: BetSuggestion) {
  return (
    suggestion.odds_source === "french_bookmaker" ||
    Boolean(suggestion.is_french_bookmaker) ||
    isFrenchBookmakerName(suggestion.bookmaker)
  );
}

type OddsScope = "fr" | "book" | "model";
type CatalogScope = "all" | "fr" | "book" | "model";
type ExplorerScope = "recommended" | "fr" | "book" | "model";

const PARLAY_PROFILE_OPTIONS: {
  value: MatchParlayRiskProfile;
  label: string;
  description: string;
}[] = [
  {
    value: "prudent",
    label: "Prudent",
    description: "Fiabilite renforcee, moins de selections.",
  },
  {
    value: "balanced",
    label: "Equilibre",
    description: "Compromis cote cible / probabilite.",
  },
  {
    value: "aggressive",
    label: "Agressif",
    description: "Plus de variance, jamais garanti.",
  },
];

function suggestionMatchesScope(suggestion: BetSuggestion, scope: OddsScope) {
  if (scope === "fr") {
    return suggestion.source === "bookmaker" && isFrenchSuggestion(suggestion);
  }
  if (scope === "book") {
    return suggestion.source === "bookmaker";
  }
  return suggestion.source !== "bookmaker";
}

function catalogMatchesScope(entry: MatchMarketCatalogEntry, scope: CatalogScope) {
  if (scope === "fr") return entry.status === "fr_available";
  if (scope === "book") {
    return entry.status === "fr_available" || entry.status === "global_available";
  }
  if (scope === "model") {
    return entry.status === "model_only" || entry.status === "proxy_only";
  }
  return true;
}

function marketCatalogKey(entry: Pick<MatchMarketCatalogEntry, "category" | "market">) {
  return `${entry.category}::${entry.market}`;
}

function suggestionMatchesCatalogEntry(
  suggestion: BetSuggestion,
  entry: MatchMarketCatalogEntry,
) {
  return suggestion.category === entry.category && suggestion.market === entry.market;
}

function explorerMatchesScope(suggestion: BetSuggestion, scope: ExplorerScope) {
  if (scope === "recommended") return suggestion.playability !== "eviter";
  if (scope === "fr") return suggestion.source === "bookmaker" && isFrenchSuggestion(suggestion);
  if (scope === "book") return suggestion.source === "bookmaker";
  return suggestion.source !== "bookmaker";
}

function explorerSuggestionScore(suggestion: BetSuggestion) {
  const playability =
    suggestion.playability === "jouable"
      ? 1000
      : suggestion.playability === "surveillance"
        ? 500
        : 0;
  const source =
    suggestion.odds_source === "french_bookmaker"
      ? 180
      : suggestion.source === "bookmaker"
        ? 90
        : suggestion.data_level === "proxy"
          ? -80
          : 20;
  const edge = suggestion.edge == null ? -20 : suggestion.edge * 220;
  const reliability = suggestion.reliability_score || 0;
  return playability + source + reliability + edge + suggestion.probability * 40;
}

function BetSuggestionsPanel({
  eventId,
  builder,
}: {
  eventId: number;
  builder: MatchBetBuilder;
}) {
  const [oddsScope, setOddsScope] = useState<OddsScope>("fr");
  const frCount = builder.suggestions.filter((suggestion) =>
    suggestionMatchesScope(suggestion, "fr"),
  ).length;
  const bookCount = builder.suggestions.filter((suggestion) =>
    suggestionMatchesScope(suggestion, "book"),
  ).length;
  const modelCount = builder.suggestions.filter((suggestion) =>
    suggestionMatchesScope(suggestion, "model"),
  ).length;
  const visibleSuggestions = builder.suggestions.filter((suggestion) =>
    suggestionMatchesScope(suggestion, oddsScope),
  );
  const grouped = visibleSuggestions.reduce<Record<string, BetSuggestion[]>>(
    (acc, suggestion) => {
      acc[suggestion.category] = acc[suggestion.category] || [];
      acc[suggestion.category].push(suggestion);
      return acc;
    },
    {},
  );
  const categoryOrder = [
    "Resultat",
    "Buts",
    "Buts equipe",
    "Mi-temps",
    "Handicap",
    "Defense",
    "Scenario",
    "Joueurs",
    "Joueurs - tirs",
    "Joueurs - discipline",
    "Corners",
    "Cartons",
    "Score exact",
  ];

  return (
    <div className="card space-y-4">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white flex items-center gap-2">
            <TrendingUp size={16} className="text-green-400" />
            Propositions de paris enrichies
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Priorite aux cotes francaises quand disponibles; sinon fallback bookmaker global ou cote modele.
          </p>
        </div>
        <div className="text-xs text-gray-400 md:text-right">
          <div>{builder.bookmaker_markets} marches bookmaker lus</div>
          <div>{builder.model_markets} marches derives modele</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {builder.preferred_bookmakers.map((bookmaker) => (
          <span key={bookmaker} className="rounded-full bg-gray-800 px-2.5 py-1 text-xs text-gray-400">
            {bookmaker}
          </span>
        ))}
      </div>

      {builder.odds_coverage && (
        <div className="grid grid-cols-1 gap-3 rounded-2xl border border-emerald-900/40 bg-emerald-950/10 p-3 md:grid-cols-[1.2fr_0.8fr]">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
              Couverture bookmakers francais
            </div>
            <p className="mt-1 text-xs text-gray-400">{builder.odds_coverage.note}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(builder.odds_coverage.french_bookmakers.length
                ? builder.odds_coverage.french_bookmakers
                : ["Aucun book FR detecte"]
              ).map((bookmaker) => (
                <span
                  key={bookmaker}
                  className="rounded-full border border-emerald-900/60 bg-emerald-950/30 px-2.5 py-1 text-[11px] text-emerald-200"
                >
                  {bookmaker}
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Marches FR" value={String(builder.odds_coverage.french_markets)} highlight="green" />
            <Stat label="Fallbacks" value={String(builder.odds_coverage.global_markets)} />
            <Stat label="Statut" value={builder.odds_coverage.availability} />
          </div>
        </div>
      )}

      {builder.market_catalog && builder.market_catalog.length > 0 && (
        <MarketCatalogPanel catalog={builder.market_catalog} />
      )}

      {builder.market_catalog && builder.market_catalog.length > 0 && (
        <MarketExplorerPanel eventId={eventId} builder={builder} />
      )}

      <div className="flex flex-col gap-2 rounded-2xl border border-gray-800 bg-gray-950/60 p-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Source des cotes affichees
          </div>
          <div className="text-[11px] text-gray-600 mt-1">
            Par defaut, l'outil colle aux books disponibles en France. Les autres cotes restent consultables.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterPill active={oddsScope === "fr"} onClick={() => setOddsScope("fr")}>
            Cotes FR ({frCount})
          </FilterPill>
          <FilterPill active={oddsScope === "book"} onClick={() => setOddsScope("book")}>
            Toutes cotes ({bookCount})
          </FilterPill>
          <FilterPill active={oddsScope === "model"} onClick={() => setOddsScope("model")}>
            Modele/proxy ({modelCount})
          </FilterPill>
        </div>
      </div>

      <div className="space-y-4">
        {visibleSuggestions.length === 0 ? (
          <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 text-sm text-gray-500">
            Aucune selection disponible dans ce filtre. Passe sur "Toutes cotes" ou "Modele/proxy" pour voir les autres signaux.
          </div>
        ) : categoryOrder
          .filter((category) => grouped[category]?.length)
          .map((category, index) => (
            <details key={category} className="group rounded-2xl border border-gray-800 bg-gray-950/35 p-3" open={index < 2}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {category}
                  </div>
                  <div className="text-[11px] text-gray-600">
                    {grouped[category].length} selection(s)
                  </div>
                </div>
                <ChevronDown size={15} className="text-gray-500 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                {grouped[category].slice(0, category === "Joueurs" ? 8 : 6).map((suggestion) => (
                  <SuggestionCard key={suggestion.id} suggestion={suggestion} />
                ))}
              </div>
            </details>
          ))}
      </div>

      <div className="rounded-xl border border-yellow-900/70 bg-yellow-950/20 p-3 space-y-1">
        {builder.warnings.map((warning, index) => (
          <div key={index} className="text-xs text-yellow-200/75">
            {warning}
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-200"
          : "border-gray-800 bg-gray-900 text-gray-500 hover:border-gray-700 hover:text-gray-300",
      )}
    >
      {children}
    </button>
  );
}

function MarketCatalogPanel({ catalog }: { catalog: MatchMarketCatalogEntry[] }) {
  const [scope, setScope] = useState<CatalogScope>("all");
  const frCount = catalog.filter((entry) => catalogMatchesScope(entry, "fr")).length;
  const bookCount = catalog.filter((entry) => catalogMatchesScope(entry, "book")).length;
  const modelCount = catalog.filter((entry) => catalogMatchesScope(entry, "model")).length;
  const visible = catalog.filter((entry) => catalogMatchesScope(entry, scope));

  return (
    <div className="rounded-2xl border border-cyan-900/40 bg-cyan-950/10 p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-cyan-300">
            <Target size={14} />
            Catalogue des marches
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Vision rapide de ce qui est vraiment cote chez les books FR, ce qui vient d'un fallback global, et ce qui reste une projection.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterPill active={scope === "all"} onClick={() => setScope("all")}>
            Tout ({catalog.length})
          </FilterPill>
          <FilterPill active={scope === "fr"} onClick={() => setScope("fr")}>
            FR ({frCount})
          </FilterPill>
          <FilterPill active={scope === "book"} onClick={() => setScope("book")}>
            Books ({bookCount})
          </FilterPill>
          <FilterPill active={scope === "model"} onClick={() => setScope("model")}>
            Modele/proxy ({modelCount})
          </FilterPill>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {visible.slice(0, 15).map((entry) => (
          <MarketCatalogCard key={`${entry.category}-${entry.market}`} entry={entry} />
        ))}
      </div>

      {visible.length > 15 && (
        <div className="mt-2 text-center text-[11px] text-gray-600">
          {visible.length - 15} autre(s) marche(s) masque(s) pour garder l'ecran lisible.
        </div>
      )}
    </div>
  );
}

function marketStatusCopy(status: MatchMarketCatalogEntry["status"]) {
  if (status === "fr_available") {
    return {
      label: "Cote FR dispo",
      className: "border-emerald-800/70 bg-emerald-950/35 text-emerald-300",
    };
  }
  if (status === "global_available") {
    return {
      label: "Fallback book",
      className: "border-blue-800/60 bg-blue-950/30 text-blue-300",
    };
  }
  if (status === "model_only") {
    return {
      label: "Modele",
      className: "border-gray-700 bg-gray-900 text-gray-300",
    };
  }
  return {
    label: "Proxy",
    className: "border-red-900/60 bg-red-950/25 text-red-300",
  };
}

function MarketCatalogCard({ entry }: { entry: MatchMarketCatalogEntry }) {
  const status = marketStatusCopy(entry.status);
  const best = entry.best_selection;

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/80 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-gray-600">
            {entry.category}
          </div>
          <div className="mt-0.5 font-semibold text-white">{entry.market}</div>
        </div>
        <span className={clsx("shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold", status.className)}>
          {status.label}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <Stat label="FR" value={String(entry.french_bookmaker_selections)} highlight={entry.french_bookmaker_selections ? "green" : undefined} />
        <Stat label="Book" value={String(entry.global_bookmaker_selections)} />
        <Stat label="Modele" value={String(entry.model_selections)} />
        <Stat label="Proxy" value={String(entry.proxy_selections)} highlight={entry.proxy_selections ? "red" : undefined} />
      </div>

      {best && (
        <div className="mt-3 rounded-xl border border-gray-800 bg-gray-950/45 p-2">
          <div className="text-[11px] text-gray-500">Meilleur signal</div>
          <div className="mt-0.5 text-sm font-semibold text-white line-clamp-1">
            {best.label}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
            <span>{(best.probability * 100).toFixed(1)}%</span>
            <span>{formatOdds(best.offered_odds || best.fair_odds)}</span>
            {best.edge != null && (
              <span className={best.edge > 0 ? "text-green-300" : "text-red-300"}>
                {best.edge > 0 ? "+" : ""}{(best.edge * 100).toFixed(1)}% edge
              </span>
            )}
            {best.bookmaker && <span>{best.bookmaker}</span>}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {entry.available_bookmakers.slice(0, 4).map((bookmaker) => (
          <span key={bookmaker} className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] text-gray-400">
            {bookmaker}
          </span>
        ))}
        {!entry.available_bookmakers.length && (
          <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] text-gray-500">
            aucune cote book
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-gray-600">
        <span>{entry.total_selections} selection(s)</span>
        <span>{entry.playable_count} jouable(s)</span>
        <span>fiab. {entry.average_reliability == null ? "n/a" : `${entry.average_reliability.toFixed(0)}/100`}</span>
      </div>
    </div>
  );
}

function MarketExplorerPanel({
  eventId,
  builder,
}: {
  eventId: number;
  builder: MatchBetBuilder;
}) {
  const catalog = builder.market_catalog || [];
  const preferredEntry =
    catalog.find((entry) => entry.playable_count > 0 && entry.status === "fr_available") ||
    catalog.find((entry) => entry.playable_count > 0) ||
    catalog[0];
  const [selectedKey, setSelectedKey] = useState(
    preferredEntry ? marketCatalogKey(preferredEntry) : "",
  );
  const [scope, setScope] = useState<ExplorerScope>("recommended");
  const [ticketSelectionIds, setTicketSelectionIds] = useState<string[]>([]);
  const [ticketTargetOdds, setTicketTargetOdds] = useState("3.00");
  const [ticketStake, setTicketStake] = useState("");
  const [ticketRiskProfile, setTicketRiskProfile] = useState<MatchParlayRiskProfile>("balanced");
  const [autoTicketLoading, setAutoTicketLoading] = useState(false);
  const [autoTicketError, setAutoTicketError] = useState("");
  const [autoTicketResult, setAutoTicketResult] = useState<MatchParlayResponse | null>(null);
  const selectedEntry =
    catalog.find((entry) => marketCatalogKey(entry) === selectedKey) ||
    preferredEntry;
  const ticketSuggestions = ticketSelectionIds
    .map((id) => builder.suggestions.find((suggestion) => suggestion.id === id))
    .filter((suggestion): suggestion is BetSuggestion => Boolean(suggestion));

  const toggleTicketSuggestion = (suggestion: BetSuggestion) => {
    setAutoTicketResult(null);
    setAutoTicketError("");
    setTicketSelectionIds((current) => {
      if (current.includes(suggestion.id)) {
        return current.filter((id) => id !== suggestion.id);
      }
      if (suggestion.playability === "eviter") return current;

      const withoutConflicts = current.filter((id) => {
        const selected = builder.suggestions.find((item) => item.id === id);
        if (!selected) return false;
        if (!suggestion.conflict_key) return true;
        return selected.conflict_key !== suggestion.conflict_key;
      });

      if (withoutConflicts.length >= 5) return current;
      return [...withoutConflicts, suggestion.id];
    });
  };

  const generateAutoTicket = async () => {
    const targetOdds = Number(ticketTargetOdds);
    const stake = Number(ticketStake);
    if (!Number.isFinite(targetOdds) || targetOdds < 1.1) {
      setAutoTicketError("Entre une cote cible valide, minimum 1.10.");
      return;
    }

    setAutoTicketLoading(true);
    setAutoTicketError("");
    setAutoTicketResult(null);
    try {
      const response = await api.generateSameMatchParlay(eventId, {
        target_odds: targetOdds,
        stake: Number.isFinite(stake) && stake > 0 ? stake : undefined,
        max_legs: ticketRiskProfile === "aggressive" ? 5 : ticketRiskProfile === "prudent" ? 3 : 4,
        risk_profile: ticketRiskProfile,
      });
      setAutoTicketResult(response);
      if (response.success && response.parlay) {
        setTicketSelectionIds(response.parlay.legs.map((leg) => leg.id));
      } else {
        setAutoTicketError(response.message || "Aucun ticket recommande dans ces conditions.");
      }
    } catch (error) {
      setAutoTicketError(error instanceof Error ? error.message : "Generation automatique indisponible.");
    } finally {
      setAutoTicketLoading(false);
    }
  };

  if (!selectedEntry) return null;

  const marketSuggestions = builder.suggestions
    .filter((suggestion) => suggestionMatchesCatalogEntry(suggestion, selectedEntry))
    .sort((a, b) => explorerSuggestionScore(b) - explorerSuggestionScore(a));
  const recommendedCount = marketSuggestions.filter((suggestion) =>
    explorerMatchesScope(suggestion, "recommended"),
  ).length;
  const frCount = marketSuggestions.filter((suggestion) =>
    explorerMatchesScope(suggestion, "fr"),
  ).length;
  const bookCount = marketSuggestions.filter((suggestion) =>
    explorerMatchesScope(suggestion, "book"),
  ).length;
  const modelCount = marketSuggestions.filter((suggestion) =>
    explorerMatchesScope(suggestion, "model"),
  ).length;
  const visible = marketSuggestions.filter((suggestion) =>
    explorerMatchesScope(suggestion, scope),
  );
  const status = marketStatusCopy(selectedEntry.status);

  return (
    <div className="rounded-2xl border border-emerald-900/40 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.13),transparent_34%),rgba(6,78,59,0.08)] p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-300">
            <Sparkles size={14} />
            Market Explorer
          </div>
          <h3 className="mt-1 text-lg font-black text-white">
            Explorer un marche precis
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            Selectionne un marche, puis compare les cotes FR, fallbacks books et projections modele sans bruit autour.
          </p>
        </div>
        <span className={clsx("w-fit rounded-full border px-3 py-1.5 text-xs font-bold", status.className)}>
          {status.label}
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
            Choisir le marche
          </div>
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1 scrollbar-none">
            {catalog.map((entry) => {
              const active = marketCatalogKey(entry) === marketCatalogKey(selectedEntry);
              const entryStatus = marketStatusCopy(entry.status);
              return (
                <button
                  key={marketCatalogKey(entry)}
                  type="button"
                  onClick={() => setSelectedKey(marketCatalogKey(entry))}
                  className={clsx(
                    "w-full rounded-2xl border p-3 text-left transition-colors",
                    active
                      ? "border-emerald-600/70 bg-emerald-950/35"
                      : "border-gray-800 bg-gray-950/35 hover:border-gray-700",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wide text-gray-600">
                        {entry.category}
                      </div>
                      <div className="mt-0.5 text-sm font-semibold text-white">
                        {entry.market}
                      </div>
                    </div>
                    <span className={clsx("shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold", entryStatus.className)}>
                      {entryStatus.label}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-gray-500">
                    <span>{entry.total_selections} selections</span>
                    <span>·</span>
                    <span>{entry.playable_count} jouable(s)</span>
                    {entry.average_reliability != null && (
                      <>
                        <span>·</span>
                        <span>{entry.average_reliability.toFixed(0)}/100</span>
                      </>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-gray-800 bg-gray-950/45 p-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-600">
                  {selectedEntry.category}
                </div>
                <h4 className="mt-0.5 text-xl font-black text-white">
                  {selectedEntry.market}
                </h4>
                <p className="mt-1 text-xs text-gray-500">
                  {selectedEntry.available_bookmakers.length
                    ? `Books: ${selectedEntry.available_bookmakers.join(", ")}`
                    : "Aucune cote bookmaker: marche estime par le modele."}
                </p>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center md:min-w-[360px]">
                <Stat label="FR" value={String(selectedEntry.french_bookmaker_selections)} highlight={selectedEntry.french_bookmaker_selections ? "green" : undefined} />
                <Stat label="Book" value={String(selectedEntry.global_bookmaker_selections)} />
                <Stat label="Jouable" value={String(selectedEntry.playable_count)} highlight={selectedEntry.playable_count ? "green" : undefined} />
                <Stat label="Eviter" value={String(selectedEntry.avoid_count)} highlight={selectedEntry.avoid_count ? "red" : undefined} />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-2xl border border-gray-800 bg-gray-950/45 p-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Affichage des options
              </div>
              <div className="mt-1 text-[11px] text-gray-600">
                Le tri favorise jouable, cote FR, edge positif et fiabilite.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <FilterPill active={scope === "recommended"} onClick={() => setScope("recommended")}>
                Recommandees ({recommendedCount})
              </FilterPill>
              <FilterPill active={scope === "fr"} onClick={() => setScope("fr")}>
                FR ({frCount})
              </FilterPill>
              <FilterPill active={scope === "book"} onClick={() => setScope("book")}>
                Books ({bookCount})
              </FilterPill>
              <FilterPill active={scope === "model"} onClick={() => setScope("model")}>
                Modele/proxy ({modelCount})
              </FilterPill>
            </div>
          </div>

          <MarketExplorerTicket
            selected={ticketSuggestions}
            targetOdds={ticketTargetOdds}
            stake={ticketStake}
            riskProfile={ticketRiskProfile}
            onTargetOddsChange={setTicketTargetOdds}
            onStakeChange={setTicketStake}
            onRiskProfileChange={(profile) => {
              setAutoTicketResult(null);
              setAutoTicketError("");
              setTicketRiskProfile(profile);
            }}
            autoLoading={autoTicketLoading}
            autoError={autoTicketError}
            autoResult={autoTicketResult}
            onAutoGenerate={generateAutoTicket}
            onRemove={(id) => {
              setAutoTicketResult(null);
              setAutoTicketError("");
              setTicketSelectionIds((current) => current.filter((selectedId) => selectedId !== id));
            }}
            onClear={() => {
              setAutoTicketResult(null);
              setAutoTicketError("");
              setTicketSelectionIds([]);
            }}
          />

          {visible.length === 0 ? (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/75 p-4 text-sm text-gray-500">
              Aucune option dans ce filtre pour ce marche.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
              {visible.slice(0, 8).map((suggestion) => (
                <ExplorerSuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  selected={ticketSelectionIds.includes(suggestion.id)}
                  disabled={
                    suggestion.playability === "eviter" ||
                    (ticketSuggestions.length >= 5 && !ticketSelectionIds.includes(suggestion.id))
                  }
                  onToggle={() => toggleTicketSuggestion(suggestion)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MarketExplorerTicket({
  selected,
  targetOdds,
  stake,
  riskProfile,
  onTargetOddsChange,
  onStakeChange,
  onRiskProfileChange,
  autoLoading,
  autoError,
  autoResult,
  onAutoGenerate,
  onRemove,
  onClear,
}: {
  selected: BetSuggestion[];
  targetOdds: string;
  stake: string;
  riskProfile: MatchParlayRiskProfile;
  onTargetOddsChange: (value: string) => void;
  onStakeChange: (value: string) => void;
  onRiskProfileChange: (value: MatchParlayRiskProfile) => void;
  autoLoading: boolean;
  autoError: string;
  autoResult: MatchParlayResponse | null;
  onAutoGenerate: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const totalOdds = selected.reduce((product, suggestion) => product * displayedOdds(suggestion), 1);
  const estimatedProbability = selected.length
    ? selected.reduce((product, suggestion) => product * boundedProbability(suggestion.probability), 1)
    : 0;
  const targetValue = Number(targetOdds);
  const stakeValue = Number(stake);
  const hasTarget = Number.isFinite(targetValue) && targetValue > 1;
  const hasStake = Number.isFinite(stakeValue) && stakeValue > 0;
  const backendTotalOdds = autoResult?.success && autoResult.parlay ? autoResult.parlay.total_odds : null;
  const backendProbability =
    autoResult?.success && autoResult.parlay ? autoResult.parlay.estimated_probability : null;
  const backendPotentialReturn =
    autoResult?.success && autoResult.parlay ? autoResult.parlay.potential_return : null;
  const displayedTicketOdds = backendTotalOdds ?? totalOdds;
  const displayedTicketProbability = backendProbability ?? estimatedProbability;
  const approximateEv = selected.length ? displayedTicketProbability * displayedTicketOdds - 1 : 0;
  const targetGap = hasTarget && selected.length ? displayedTicketOdds - targetValue : null;
  const potentialReturn = hasStake && selected.length ? stakeValue * displayedTicketOdds : null;
  const unconfirmedCount = selected.filter(
    (suggestion) => suggestion.source !== "bookmaker" || !suggestion.offered_odds,
  ).length;
  const negativeEdgeCount = selected.filter(
    (suggestion) => suggestion.edge != null && suggestion.edge <= 0,
  ).length;
  const appliedProfile =
    PARLAY_PROFILE_OPTIONS.find((option) => option.value === (autoResult?.risk_profile || riskProfile)) ||
    PARLAY_PROFILE_OPTIONS[1];

  return (
    <div className="rounded-2xl border border-cyan-900/50 bg-cyan-950/10 p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-cyan-300">
            <Target size={14} />
            Ticket Market Explorer
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Ajoute des options depuis le marche ouvert. L'outil evite les doublons contradictoires et calcule un ticket approximatif.
          </p>
        </div>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="w-fit rounded-full border border-gray-700 px-3 py-1 text-xs font-semibold text-gray-400 transition-colors hover:border-red-800 hover:text-red-300"
          >
            Vider
          </button>
        )}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[220px_1fr]">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Cote cible
            </span>
            <input
              type="number"
              min="1.1"
              step="0.1"
              value={targetOdds}
              onChange={(event) => onTargetOddsChange(event.target.value)}
              className="w-full rounded-xl border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Mise
            </span>
            <input
              type="number"
              min="0"
              step="1"
              placeholder="ex: 20"
              value={stake}
              onChange={(event) => onStakeChange(event.target.value)}
              className="w-full rounded-xl border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
            />
          </label>
          <div className="col-span-2 space-y-1 lg:col-span-1">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Profil
            </span>
            <div className="grid grid-cols-3 gap-1 lg:grid-cols-1">
              {PARLAY_PROFILE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onRiskProfileChange(option.value)}
                  className={clsx(
                    "rounded-xl border px-2 py-2 text-left transition-colors",
                    riskProfile === option.value
                      ? "border-cyan-500/80 bg-cyan-500/15 text-cyan-100"
                      : "border-gray-800 bg-gray-950 text-gray-500 hover:border-gray-700 hover:text-gray-300",
                  )}
                >
                  <span className="block text-[11px] font-black uppercase tracking-wide">
                    {option.label}
                  </span>
                  <span className="hidden text-[10px] leading-snug lg:block">
                    {option.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={onAutoGenerate}
            disabled={autoLoading || !hasTarget}
            className={clsx(
              "col-span-2 rounded-xl border px-3 py-2 text-xs font-black uppercase tracking-wide transition-colors lg:col-span-1",
              autoLoading || !hasTarget
                ? "cursor-not-allowed border-gray-800 bg-gray-950 text-gray-600"
                : "border-cyan-600/70 bg-cyan-500/15 text-cyan-100 hover:border-cyan-300",
            )}
          >
            {autoLoading ? "Recherche..." : "Auto proche cible"}
          </button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Stat label="Selections" value={String(selected.length)} highlight={selected.length ? "green" : undefined} />
            <Stat
              label="Cote ticket"
              value={selected.length ? formatOdds(displayedTicketOdds) : "n/a"}
              highlight={selected.length ? "green" : undefined}
            />
            <Stat
              label="Proba approx."
              value={selected.length ? `${(displayedTicketProbability * 100).toFixed(1)}%` : "n/a"}
            />
            <Stat
              label="EV approx."
              value={selected.length ? `${approximateEv >= 0 ? "+" : ""}${(approximateEv * 100).toFixed(1)}%` : "n/a"}
              highlight={selected.length ? (approximateEv > 0 ? "green" : "red") : undefined}
            />
            <Stat
              label="Retour"
              value={(backendPotentialReturn ?? potentialReturn) == null ? "n/a" : formatCurrencyEUR(backendPotentialReturn ?? potentialReturn ?? 0)}
            />
          </div>

          {autoError && (
            <div className="rounded-xl border border-yellow-900 bg-yellow-950/25 p-3 text-xs text-yellow-200">
              {autoError}
            </div>
          )}

          {autoResult?.success && autoResult.parlay && (
            <div className="rounded-xl border border-cyan-800/60 bg-cyan-950/20 p-3 text-xs text-cyan-100">
              Ticket automatique {appliedProfile.label.toLowerCase()} applique: le backend a choisi {autoResult.parlay.legs.length} selection(s) pour viser {formatOdds(autoResult.target_odds)} avec les contraintes de fiabilite.
            </div>
          )}

          {selected.length === 0 ? (
            <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-3 text-xs text-gray-500">
              Selectionne une ou plusieurs options ci-dessous pour composer un ticket sur ce match.
            </div>
          ) : (
            <div className="space-y-2">
              {selected.map((suggestion, index) => (
                <div
                  key={suggestion.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-gray-800 bg-gray-950/65 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">
                      {index + 1}. {suggestion.label}
                    </div>
                    <div className="mt-0.5 text-[11px] text-gray-500">
                      {formatOdds(displayedOdds(suggestion))} - proba modele {(suggestion.probability * 100).toFixed(1)}%
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(suggestion.id)}
                    className="shrink-0 rounded-full border border-gray-700 px-2 py-1 text-[10px] font-semibold text-gray-500 transition-colors hover:border-red-800 hover:text-red-300"
                  >
                    Retirer
                  </button>
                </div>
              ))}
            </div>
          )}

          {selected.length > 0 && (
            <div className="space-y-1 rounded-xl border border-yellow-900/40 bg-yellow-950/10 p-3 text-[11px] text-yellow-200/80">
              {targetGap != null && targetGap < 0 && (
                <p>La cote cible n'est pas atteinte: il manque environ {Math.abs(targetGap).toFixed(2)} point(s) de cote.</p>
              )}
              {targetGap != null && targetGap >= 0 && (
                <p>La cote cible est atteinte, mais ce n'est pas une garantie: le ticket reste probabiliste.</p>
              )}
              {selected.length > 1 && (
                <p>Attention: selections sur le meme match, correlation possible. La proba et l'EV sont des approximations.</p>
              )}
              {unconfirmedCount > 0 && (
                <p>{unconfirmedCount} selection(s) utilisent une cote modele/proxy non confirmee par bookmaker.</p>
              )}
              {negativeEdgeCount > 0 && (
                <p>{negativeEdgeCount} selection(s) ont un edge non positif: a surveiller plutot qu'a recommander.</p>
              )}
              {autoResult?.success && autoResult.parlay?.warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ExplorerSuggestionCard({
  suggestion,
  selected,
  disabled,
  onToggle,
}: {
  suggestion: BetSuggestion;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const playable = suggestion.source === "bookmaker" && suggestion.offered_odds;
  return (
    <div
      className={clsx(
        "rounded-2xl border bg-gray-900/85 p-3 transition-colors",
        selected ? "border-cyan-500/70 shadow-[0_0_0_1px_rgba(34,211,238,0.2)]" : "border-gray-800",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-white">{suggestion.label}</div>
          <div className="mt-1 text-xs text-gray-500">{suggestion.selection}</div>
        </div>
        <span
          className={clsx(
            "shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide",
            suggestion.playability === "jouable"
              ? "bg-emerald-900/40 text-emerald-300"
              : suggestion.playability === "eviter"
                ? "bg-red-900/40 text-red-300"
                : "bg-amber-900/40 text-amber-300",
          )}
        >
          {suggestion.playability || "surveillance"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <Stat label="Modele" value={`${(suggestion.probability * 100).toFixed(1)}%`} />
        <Stat
          label={playable ? "Cote" : "Fair"}
          value={formatOdds(playable ? suggestion.offered_odds : suggestion.fair_odds)}
          highlight={playable && isFrenchSuggestion(suggestion) ? "green" : undefined}
        />
        <Stat
          label="Edge"
          value={suggestion.edge == null ? "n/a" : `${suggestion.edge > 0 ? "+" : ""}${(suggestion.edge * 100).toFixed(1)}%`}
          highlight={suggestion.edge == null ? undefined : suggestion.edge > 0 ? "green" : "red"}
        />
        <Stat
          label="Fiab."
          value={suggestion.reliability_score == null ? "n/a" : `${suggestion.reliability_score.toFixed(0)}`}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={clsx(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            suggestion.source === "bookmaker"
              ? isFrenchSuggestion(suggestion)
                ? "bg-emerald-900/40 text-emerald-300"
                : "bg-blue-900/40 text-blue-300"
              : suggestion.data_level === "proxy"
                ? "bg-red-900/40 text-red-300"
                : "bg-gray-800 text-gray-300",
          )}
        >
          {suggestion.source === "bookmaker"
            ? isFrenchSuggestion(suggestion)
              ? "cote FR"
              : "fallback book"
            : suggestion.data_level === "proxy"
              ? "proxy"
              : "modele"}
        </span>
        {suggestion.bookmaker_display || suggestion.bookmaker ? (
          <span className="text-[10px] text-gray-500">
            {suggestion.bookmaker_display || suggestion.bookmaker}
          </span>
        ) : null}
        {suggestion.market_signal && <MarketSignalBadge signal={suggestion.market_signal} />}
      </div>

      <p className="mt-3 line-clamp-2 text-xs text-gray-500">{suggestion.rationale}</p>

      <button
        type="button"
        onClick={onToggle}
        disabled={disabled && !selected}
        className={clsx(
          "mt-3 w-full rounded-xl border px-3 py-2 text-xs font-bold transition-colors",
          selected
            ? "border-cyan-600 bg-cyan-950/35 text-cyan-200 hover:border-cyan-400"
            : disabled
              ? "cursor-not-allowed border-gray-800 bg-gray-950 text-gray-600"
              : "border-gray-700 bg-gray-950/70 text-gray-300 hover:border-cyan-700 hover:text-cyan-200",
        )}
      >
        {selected ? "Retirer du ticket" : disabled ? "Non retenu" : "Ajouter au ticket"}
      </button>
    </div>
  );
}

function SuggestionCard({ suggestion }: { suggestion: BetSuggestion }) {
  const playable = suggestion.source === "bookmaker" && suggestion.offered_odds;
  const edge = suggestion.edge;

  return (
    <div className="rounded-xl bg-gray-800/70 p-3 border border-gray-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-white text-sm">{suggestion.label}</div>
          <div className="text-xs text-gray-500 mt-1">{suggestion.market}</div>
        </div>
        <span
          className={clsx(
            "shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold",
            suggestion.risk_level === "prudent"
              ? "bg-green-900/40 text-green-400"
              : suggestion.risk_level === "balanced"
                ? "bg-yellow-900/40 text-yellow-400"
                : "bg-red-900/40 text-red-400",
          )}
        >
          {suggestion.risk_level}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Modele" value={`${(suggestion.probability * 100).toFixed(1)}%`} />
        <Stat
          label={playable ? suggestion.bookmaker_display || suggestion.bookmaker || "Book" : "Estimation"}
          value={formatOdds(playable ? suggestion.offered_odds : displayedOdds(suggestion))}
          highlight={playable && isFrenchSuggestion(suggestion) ? "green" : undefined}
        />
        <Stat
          label="Edge"
          value={edge == null ? "n/a" : `${edge > 0 ? "+" : ""}${(edge * 100).toFixed(1)}%`}
          highlight={edge == null ? undefined : edge > 0 ? "green" : "red"}
        />
      </div>

      <p className="text-xs text-gray-500 mt-3">{suggestion.rationale}</p>
      {!playable && (
        <p className="text-[11px] text-yellow-500/80 mt-2">
          Cote non confirmee par bookmaker sur ce marche.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {suggestion.reliability_score != null && (
          <ReliabilityBadge suggestion={suggestion} />
        )}
        {suggestion.market_signal && (
          <MarketSignalBadge signal={suggestion.market_signal} />
        )}
        <span
          className={clsx(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            suggestion.data_level === "bookmaker"
              ? "bg-green-900/40 text-green-300"
              : suggestion.data_level === "proxy"
                ? "bg-red-900/40 text-red-300"
                : "bg-blue-900/40 text-blue-300",
          )}
        >
          {suggestion.data_level === "bookmaker"
            ? isFrenchSuggestion(suggestion)
              ? "cote FR"
              : "fallback book"
            : suggestion.data_level === "proxy"
              ? "proxy experimental"
              : "modele"}
        </span>
        <span className="text-[10px] text-gray-600">
          Confiance {suggestion.confidence}
        </span>
      </div>
      {suggestion.data_note && (
        <p className="text-[11px] text-gray-500 mt-2">{suggestion.data_note}</p>
      )}
      {playable && suggestion.bookmaker_source_label && (
        <p className="text-[11px] text-gray-600 mt-1">
          Source cote: {suggestion.bookmaker_source_label}
        </p>
      )}
    </div>
  );
}

function ReliabilityBadge({ suggestion }: { suggestion: BetSuggestion }) {
  const score = suggestion.reliability_score ?? 0;
  const playability = suggestion.playability || "surveillance";
  return (
    <span
      title={(suggestion.reliability_reasons || []).join(" - ")}
      className={clsx(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        playability === "jouable"
          ? "bg-emerald-900/40 text-emerald-300"
          : playability === "surveillance"
            ? "bg-amber-900/40 text-amber-300"
            : "bg-red-900/40 text-red-300",
      )}
    >
      {playability} · fiabilite {score.toFixed(0)}/100
    </span>
  );
}

function SameMatchParlayPanel({ eventId }: { eventId: number }) {
  const [targetOdds, setTargetOdds] = useState("3.00");
  const [stake, setStake] = useState("");
  const [riskProfile, setRiskProfile] = useState<MatchParlayRiskProfile>("balanced");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MatchParlayResponse | null>(null);
  const [error, setError] = useState("");

  const generate = async () => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await api.generateSameMatchParlay(eventId, {
        target_odds: Number(targetOdds),
        stake: stake ? Number(stake) : undefined,
        max_legs: riskProfile === "aggressive" ? 5 : riskProfile === "prudent" ? 3 : 4,
        risk_profile: riskProfile,
      });
      setResult(response);
      if (!response.success) setError(response.message || "Aucun combine recommande.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation impossible.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card space-y-4 border border-cyan-900/50 bg-cyan-950/10">
      <div>
        <h3 className="font-semibold text-white flex items-center gap-2">
          <Target size={16} className="text-cyan-400" />
          Construire un combine sur ce match
        </h3>
        <p className="text-xs text-gray-500 mt-1">
          Entre une cote cible: l'outil cherche la combinaison la plus prudente possible sur ce match.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Cote cible</label>
          <input
            type="number"
            min="1.1"
            step="0.1"
            value={targetOdds}
            onChange={(event) => setTargetOdds(event.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-cyan-500 outline-none"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Mise optionnelle</label>
          <input
            type="number"
            min="1"
            step="1"
            placeholder="ex: 20"
            value={stake}
            onChange={(event) => setStake(event.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-cyan-500 outline-none"
          />
        </div>
        <button
          onClick={generate}
          disabled={loading || Number(targetOdds) < 1.1}
          className="btn-primary self-end min-w-[160px]"
        >
          {loading ? "Calcul..." : "Generer"}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {PARLAY_PROFILE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              setResult(null);
              setError("");
              setRiskProfile(option.value);
            }}
            className={clsx(
              "rounded-xl border px-3 py-2 text-left transition-colors",
              riskProfile === option.value
                ? "border-cyan-500/80 bg-cyan-500/15 text-cyan-100"
                : "border-gray-800 bg-gray-950/70 text-gray-500 hover:border-gray-700 hover:text-gray-300",
            )}
          >
            <span className="block text-xs font-black uppercase tracking-wide">{option.label}</span>
            <span className="hidden text-[11px] text-gray-500 sm:block">{option.description}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-yellow-900 bg-yellow-950/30 p-3 text-sm text-yellow-200">
          {error}
        </div>
      )}

      {result?.success && result.parlay && (
        <div className="rounded-xl bg-gray-900/80 border border-cyan-900/60 p-4">
          <div className="grid grid-cols-2 gap-3 mb-4 md:grid-cols-5">
            <Stat label="Cote visee" value={formatOdds(result.target_odds)} />
            <Stat label="Cote trouvee" value={formatOdds(result.parlay.total_odds)} highlight="green" />
            <Stat label="Reussite approx." value={`${(result.parlay.estimated_probability * 100).toFixed(1)}%`} />
            <Stat
              label="Profil"
              value={PARLAY_PROFILE_OPTIONS.find((option) => option.value === (result.risk_profile || riskProfile))?.label || "Equilibre"}
            />
            <Stat
              label="Gain potentiel"
              value={result.parlay.potential_return ? `${result.parlay.potential_return.toFixed(2)} EUR` : "n/a"}
            />
          </div>

          <div className="space-y-2">
            {result.parlay.legs.map((leg, index) => (
              <div key={leg.id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-800 px-3 py-2">
                <div>
                  <div className="text-sm font-semibold text-white">
                    {index + 1}. {leg.label}
                  </div>
                  <div className="text-xs text-gray-500">
                    Probabilite modele {(leg.probability * 100).toFixed(1)}%
                    {" "}· {leg.source === "bookmaker" ? leg.bookmaker : "cote modele estimee"}
                  </div>
                  {leg.market_signal && (
                    <div className="mt-1">
                      <MarketSignalBadge signal={leg.market_signal} />
                    </div>
                  )}
                </div>
                <div className="text-right font-bold text-cyan-300">
                  {formatOdds(displayedOdds(leg))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 space-y-1">
            {result.parlay.warnings.map((warning, index) => (
              <div key={index} className="text-xs text-yellow-500/80">
                {warning}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatSignedPct(value?: number | null) {
  if (value == null || Number.isNaN(value)) return "n/a";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)} pts`;
}

function MarketSignalBadge({ signal }: { signal: MarketSignal }) {
  const label =
    signal.verdict === "favorable"
      ? "marche favorable"
      : signal.verdict === "unfavorable"
        ? "marche defavorable"
        : signal.verdict === "insufficient"
          ? "historique court"
          : "marche stable";
  return (
    <span
      className={clsx(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        signal.verdict === "favorable"
          ? "bg-green-900/40 text-green-300"
          : signal.verdict === "unfavorable"
            ? "bg-red-900/40 text-red-300"
            : "bg-gray-800 text-gray-400",
      )}
      title={signal.reason}
    >
      {label}
    </span>
  );
}

function movementCopy(movement: OddsMovement) {
  if (movement.direction === "shortening") {
    return {
      label: "Cote en baisse",
      detail: "le marche donne plus de poids a cette selection",
      className: "bg-green-900/35 text-green-300 border-green-800/60",
    };
  }
  if (movement.direction === "drifting") {
    return {
      label: "Cote en hausse",
      detail: "le marche se refroidit sur cette selection",
      className: "bg-yellow-900/30 text-yellow-300 border-yellow-800/60",
    };
  }
  return {
    label: "Stable",
    detail: "pas de mouvement exploitable pour le moment",
    className: "bg-gray-800 text-gray-400 border-gray-700",
  };
}

function OddsHistoryPanel({ history }: { history: EventOddsHistoryResponse }) {
  const movements = history.movements || [];
  const playerMovements = movements
    .filter((movement) => movement.market.startsWith("player_"))
    .slice(0, 8);
  const visibleMovements = playerMovements.length
    ? playerMovements
    : movements.slice(0, 8);
  const marketSummaries = history.markets || [];

  return (
    <ProgressiveSection
      title="Historique des cotes avancees"
      subtitle={`${movements.length} mouvement(s), ${history.player_rows || 0} ligne(s) joueurs, ${history.rows_used || 0} ligne(s) analysees.`}
      icon={<BarChart2 size={16} className="text-indigo-300" />}
    >
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white flex items-center gap-2">
            <BarChart2 size={16} className="text-indigo-300" />
            Historique des cotes avancees
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Signaux issus des snapshots automatiques: joueurs, buteurs, tirs cadres, cartons et marches buts.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs min-w-[280px]">
          <Stat label="Lignes avancees" value={String(history.rows_used || 0)} />
          <Stat label="Lignes joueurs" value={String(history.player_rows || 0)} highlight={history.player_rows ? "green" : undefined} />
          <Stat label="Mouvements" value={String(movements.length)} />
        </div>
      </div>

      {marketSummaries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {marketSummaries.slice(0, 7).map((market) => (
            <span
              key={market.market}
              className="rounded-full border border-gray-800 bg-gray-900/80 px-2.5 py-1 text-xs text-gray-300"
            >
              {market.label}: {market.selections} selections / {market.bookmakers} books
            </span>
          ))}
        </div>
      )}

      {visibleMovements.length === 0 ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 text-sm text-gray-400">
          Pas encore assez de snapshots avances sur ce match. Les prochains refreshs automatiques rempliront cette zone.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {visibleMovements.map((movement) => (
            <MovementCard key={`${movement.market}:${movement.bookmaker}:${movement.selection}:${movement.point ?? ""}`} movement={movement} />
          ))}
        </div>
      )}

      <div className="rounded-xl border border-yellow-900/70 bg-yellow-950/20 p-3 space-y-1">
        {(history.warnings || []).map((warning, index) => (
          <div key={index} className="text-xs text-yellow-200/75">
            {warning}
          </div>
        ))}
      </div>
    </div>
    </ProgressiveSection>
  );
}

function MovementCard({ movement }: { movement: OddsMovement }) {
  const copy = movementCopy(movement);
  const line = movement.point == null ? "" : ` ligne ${movement.point}`;

  return (
    <div className="rounded-xl bg-gray-900/80 border border-gray-800 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-gray-500">{movement.market_label}{line}</div>
          <div className="font-semibold text-white text-sm truncate">{movement.selection}</div>
          <div className="text-xs text-gray-500 mt-1">{movement.bookmaker}</div>
        </div>
        <span className={clsx("shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold", copy.className)}>
          {copy.label}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Ouverture" value={formatOdds(movement.opening_price)} />
        <Stat label="Derniere" value={formatOdds(movement.latest_price)} />
        <Stat
          label="Proba impl."
          value={formatSignedPct(movement.implied_prob_delta)}
          highlight={(movement.implied_prob_delta || 0) > 0 ? "green" : (movement.implied_prob_delta || 0) < 0 ? "red" : undefined}
        />
      </div>

      <p className="text-xs text-gray-500 mt-3">
        {copy.detail}. {movement.observations} observation(s), signal {movement.signal_strength}.
      </p>
    </div>
  );
}

function BetCalculator({ event, pred }: { event: Event; pred: any }) {
  const [odds, setOdds] = useState("");
  const [stake, setStake] = useState("");
  const [selection, setSelection] = useState("Victoire " + event.home_team);
  const [result, setResult] = useState<any>(null);
  const [open, setOpen] = useState(false);

  const selectionMap: Record<string, number> = {
    ["Victoire " + event.home_team]: pred.prob_home,
    ["Match nul"]: pred.prob_draw,
    ["Victoire " + event.away_team]: pred.prob_away,
  };

  const markets = pred?.markets;
  if (markets?.over_under?.over_2_5 != null) {
    selectionMap["Over 2.5 buts"] = markets.over_under.over_2_5;
    selectionMap["Under 2.5 buts"] = markets.over_under.under_2_5;
  }
  if (markets?.btts?.yes != null) {
    selectionMap["Les 2 équipes marquent (Oui)"] = markets.btts.yes;
    selectionMap["Les 2 équipes marquent (Non)"] = markets.btts.no;
  }

  const analyze = () => {
    const o = parseFloat(odds);
    const s = parseFloat(stake);
    if (!o || !s || o <= 1) return;

    const modelProb = selectionMap[selection] ?? 0;
    const impliedProb = 1 / o;
    const edge = modelProb - impliedProb;
    const ev = modelProb * (o - 1) - (1 - modelProb);
    const kelly = Math.max(0, (modelProb * o - 1) / (o - 1)) * 0.25;
    const kellyStake = kelly * s * 40; // sur bankroll hypothétique = mise × 40
    const isValue = edge > 0.03 && ev > 0;
    const potentialReturn = s * o;

    setResult({ modelProb, impliedProb, edge, ev, kelly, kellyStake: Math.min(kellyStake, s), isValue, potentialReturn, o, s });
  };

  return (
    <div className="card">
      <button className="w-full flex items-center justify-between" onClick={() => setOpen(x => !x)}>
        <h3 className="font-semibold text-white flex items-center gap-2">
          <Calculator size={16} className="text-blue-400" />
          Calculateur de paris
        </h3>
        {open ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-1">
              <label className="text-xs text-gray-500 mb-1 block">Sélection</label>
              <select
                value={selection}
                onChange={e => { setSelection(e.target.value); setResult(null); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 outline-none"
              >
                {Object.keys(selectionMap).map(k => <option key={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Cote bookmaker</label>
              <input
                type="number" step="0.01" min="1.01" placeholder="ex: 2.40"
                value={odds} onChange={e => { setOdds(e.target.value); setResult(null); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Mise (€)</label>
              <input
                type="number" step="1" min="1" placeholder="ex: 50"
                value={stake} onChange={e => { setStake(e.target.value); setResult(null); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          <button
            onClick={analyze}
            disabled={!odds || !stake}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <Target size={15} />
            Analyser ce pari
          </button>

          {result && (
            <div className={clsx(
              "rounded-xl p-4 border",
              result.isValue ? "bg-green-900/20 border-green-800" : "bg-red-900/20 border-red-900"
            )}>
              <div className="flex items-center justify-between mb-3">
                <div className={clsx("text-lg font-black", result.isValue ? "text-green-400" : "text-red-400")}>
                  {result.isValue ? "✓ VALUE BET" : "✗ Pas de valeur"}
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500">Retour potentiel</div>
                  <div className="text-xl font-bold text-white">{result.potentialReturn.toFixed(2)} €</div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Stat label="Prob. modèle" value={`${(result.modelProb * 100).toFixed(1)}%`} />
                <Stat label="Prob. implicite" value={`${(result.impliedProb * 100).toFixed(1)}%`} />
                <Stat
                  label="Edge"
                  value={`${result.edge > 0 ? "+" : ""}${(result.edge * 100).toFixed(1)}%`}
                  highlight={result.edge > 0 ? "green" : "red"}
                />
                <Stat
                  label="EV / unité"
                  value={`${result.ev > 0 ? "+" : ""}${(result.ev * 100).toFixed(1)}%`}
                  highlight={result.ev > 0 ? "green" : "red"}
                />
              </div>

              <div className="mt-3 pt-3 border-t border-gray-700/50 flex items-center gap-4 text-xs text-gray-400">
                <span>Mise Kelly recommandée : <span className="text-yellow-400 font-bold">{result.kellyStake.toFixed(2)} €</span></span>
                <span className="text-gray-600">·</span>
                <span>
                  {result.isValue
                    ? "Le modèle trouve de la valeur dans ce pari."
                    : "La cote ne compense pas le risque selon le modèle."}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: "green" | "red" }) {
  return (
    <div className="bg-gray-800/60 rounded-lg p-2 text-center">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className={clsx("font-bold", highlight === "green" ? "text-green-400" : highlight === "red" ? "text-red-400" : "text-white")}>
        {value}
      </div>
    </div>
  );
}

function ContextPanel({ context }: { context: MatchContext }) {
  const hasExternalSources = context.sources.length > 0;

  return (
    <ProgressiveSection
      title={hasExternalSources ? "Contexte IA avec sources" : "Contexte IA - donnees internes"}
      subtitle={context.summary}
      icon={<Sparkles size={16} className="text-cyan-400" />}
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <p className="text-sm text-gray-300">{context.summary}</p>
          <span className="shrink-0 text-xs text-gray-500">
            {new Date(context.generated_at).toLocaleString("fr-FR")}
          </span>
        </div>

      {context.factors.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {context.factors.map((factor, index) => (
            <div key={index} className="rounded-xl bg-gray-800/70 p-3">
              <div className="text-sm text-gray-200">{factor.text}</div>
              <div className="text-xs text-gray-500 mt-1">
                Fiabilite {factor.confidence} ·{" "}
                {factor.source_indices.length
                  ? `sources ${factor.source_indices.map((source) => source + 1).join(", ")}`
                  : "analyse interne"}
              </div>
            </div>
          ))}
        </div>
      )}

      {context.data_gaps.length > 0 && (
        <div className="rounded-xl border border-yellow-900/70 bg-yellow-950/20 p-3">
          <div className="text-xs font-semibold text-yellow-400 mb-1">
            Données encore manquantes
          </div>
          {context.data_gaps.map((gap, index) => (
            <div key={index} className="text-xs text-yellow-200/70">
              · {gap}
            </div>
          ))}
        </div>
      )}

      {context.sources.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {context.sources.slice(0, 6).map((source, index) => (
            <a
              key={index}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-gray-800 px-2.5 py-1 text-xs text-gray-400 hover:text-white"
            >
              [{index + 1}] {source.source || "Source"}
              <ExternalLink size={10} />
            </a>
          ))}
        </div>
      )}
      </div>
    </ProgressiveSection>
  );
}

function PlayerInsightsPanel({ insights }: { insights: PlayerInsights }) {
  return (
    <ProgressiveSection
      title="Projections joueurs"
      subtitle={`${insights.players.length} joueur(s), buteur, passe decisive, tirs cadres, carton et hors surface.`}
      icon={<Users size={16} className="text-emerald-400" />}
    >
    <div className="space-y-4">
      <div>
        <p className="text-xs text-gray-500 mt-1">{insights.methodology}</p>
        {insights.storage && (
          <p className="text-[11px] text-gray-600 mt-1">
            Source donnees: {insights.storage.source === "cache" ? "cache D1 persistant" : "recalcul frais"}
            {insights.storage.captured_at
              ? ` - ${new Date(insights.storage.captured_at).toLocaleString("fr-FR")}`
              : ""}
          </p>
        )}
      </div>

      <div className="grid gap-2 md:hidden">
        {insights.players.slice(0, 8).map((player) => (
          <PlayerMobileCard key={player.player_id} player={player} />
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[1080px] text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
              <th className="pb-2 pr-3">Joueur</th>
              <th className="pb-2 px-2 text-center">Forme tournoi</th>
              <th className="pb-2 px-2 text-center">xG / xA</th>
              <th className="pb-2 px-2 text-center">Buteur</th>
              <th className="pb-2 px-2 text-center">But/Passe</th>
              <th className="pb-2 px-2 text-center">Doublé</th>
              <th className="pb-2 px-2 text-center">Passe déc.</th>
              <th className="pb-2 px-2 text-center">1+ tir cadre</th>
              <th className="pb-2 px-2 text-center">2+ tirs cadres</th>
              <th className="pb-2 px-2 text-center">Carton</th>
              <th className="pb-2 px-2 text-center">Hors surface</th>
              <th className="pb-2 pl-2 text-right">Fiabilité</th>
            </tr>
          </thead>
          <tbody>
            {insights.players.slice(0, 12).map((player) => (
              <tr key={player.player_id} className="border-b border-gray-900">
                <td className="py-3 pr-3">
                  <div className="font-semibold text-white">{player.player}</div>
                  <div className="text-xs text-gray-500">
                    {player.team} · {player.position}
                  </div>
                </td>
                <td className="px-2 text-center text-xs text-gray-300">
                  {player.tournament_goals} B · {player.tournament_assists} PD
                  <div className="text-gray-600">
                    {player.tournament_matches} match(s)
                  </div>
                </td>
                <td className="px-2 text-center text-xs text-gray-300">
                  {player.expected_goals.toFixed(2)} / {player.expected_assists.toFixed(2)}
                  <div className="text-gray-600">attendus</div>
                </td>
                <ProbabilityCell value={player.anytime_scorer_probability} strong />
                <ProbabilityCell value={player.goal_or_assist_probability} strong />
                <ProbabilityCell value={player.brace_probability} />
                <ProbabilityCell value={player.assist_probability} />
                <ProbabilityCell value={player.shot_on_target_probability} />
                <ProbabilityCell value={player.two_shots_on_target_probability} experimental />
                <ProbabilityCell value={player.card_probability} experimental />
                <ProbabilityCell value={player.outside_box_goal_probability} experimental />
                <td className="pl-2 text-right">
                  <span className={clsx(
                    "rounded-full px-2 py-1 text-xs",
                    player.reliability === "high"
                      ? "bg-green-900/40 text-green-400"
                      : player.reliability === "medium"
                        ? "bg-yellow-900/40 text-yellow-400"
                        : "bg-gray-800 text-gray-500",
                  )}>
                    {player.reliability}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-1 border-t border-gray-800 pt-3">
        {insights.warnings.map((warning, index) => (
          <div key={index} className="text-xs text-yellow-500/80">
            · {warning}
          </div>
        ))}
      </div>
    </div>
    </ProgressiveSection>
  );
}

function PlayerMobileCard({
  player,
}: {
  player: PlayerInsights["players"][number];
}) {
  return (
    <details className="rounded-2xl border border-gray-800 bg-gray-900/80 p-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-white">{player.player}</div>
          <div className="text-xs text-gray-500">
            {player.team} - {player.position}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-black text-green-300">
            {(player.anytime_scorer_probability * 100).toFixed(0)}%
          </div>
          <div className="text-[10px] text-gray-500">buteur</div>
        </div>
      </summary>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat label="But/Passe" value={`${(player.goal_or_assist_probability * 100).toFixed(1)}%`} />
        <Stat label="Passe dec." value={`${(player.assist_probability * 100).toFixed(1)}%`} />
        <Stat label="1+ tir cadre" value={`${(player.shot_on_target_probability * 100).toFixed(1)}%`} />
        <Stat label="Carton" value={`${(player.card_probability * 100).toFixed(1)}%`} />
      </div>
      <div className="mt-2 text-[11px] text-gray-600">
        xG/xA {player.expected_goals.toFixed(2)} / {player.expected_assists.toFixed(2)} - fiabilite {player.reliability}
      </div>
    </details>
  );
}

function ProbabilityCell({
  value,
  strong = false,
  experimental = false,
}: {
  value: number;
  strong?: boolean;
  experimental?: boolean;
}) {
  return (
    <td className="px-2 text-center">
      <span className={clsx(
        "font-bold",
        strong && value >= 0.25 ? "text-green-400" : "text-gray-200",
      )}>
        {(value * 100).toFixed(1)}%
      </span>
      {experimental && <div className="text-[10px] text-gray-600">exp.</div>}
    </td>
  );
}

function ConfBadge({ c }: { c?: string }) {
  const m = { high: ["badge-value", "Haute confiance"], medium: ["badge-warn", "Conf. moyenne"], low: ["badge-low", "Faible confiance"] } as const;
  if (!c || !(c in m)) return null;
  const [cls, label] = m[c as keyof typeof m];
  return <span className={cls}>{label}</span>;
}

function QualBadge({ q }: { q?: string }) {
  const m = { good: ["badge-value", "Données bonnes"], fair: ["badge-warn", "Données correctes"], poor: ["badge-risk", "Données limitées"] } as const;
  if (!q || !(q in m)) return null;
  const [cls, label] = m[q as keyof typeof m];
  return <span className={cls}>{label}</span>;
}

function statusColor(status: string) {
  return status === "FINISHED" ? "bg-gray-700 text-gray-300"
    : status === "SCHEDULED" || status === "TIMED" ? "bg-blue-900/40 text-blue-400"
    : status === "LIVE" ? "bg-green-900/60 text-green-400 animate-pulse"
    : "bg-gray-800 text-gray-400";
}
