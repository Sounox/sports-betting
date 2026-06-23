import type { Event } from "@/lib/api";
import { getMatch, getRawMatch } from "@/lib/server/football-cloud";

const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";
const FOOTBALL_DATA_KEY =
  process.env.FOOTBALL_DATA_API_KEY ||
  "23589c0d13d34aa1bc32e5f2017b7e34";

interface SquadPlayer {
  id: number;
  name: string;
  position?: string | null;
  dateOfBirth?: string | null;
  nationality?: string | null;
}

interface TeamPayload {
  id: number;
  name: string;
  squad: SquadPlayer[];
  lastUpdated?: string;
}

interface ScorerEntry {
  player: SquadPlayer;
  team: { id: number; name: string };
  goals?: number | null;
  assists?: number | null;
  penalties?: number | null;
  playedMatches?: number | null;
}

export interface PlayerProjection {
  player_id: number;
  player: string;
  team: string;
  position: string;
  tournament_matches: number;
  tournament_goals: number;
  tournament_assists: number;
  expected_goals: number;
  anytime_scorer_probability: number;
  brace_probability: number;
  assist_probability: number;
  outside_box_goal_probability: number;
  reliability: "low" | "medium" | "high";
  evidence: string[];
}

export interface PlayerInsights {
  event_id: number;
  generated_at: string;
  methodology: string;
  data_freshness: {
    tournament_scorers: string;
    home_squad?: string;
    away_squad?: string;
  };
  players: PlayerProjection[];
  warnings: string[];
}

function positionPrior(position?: string | null) {
  const normalized = (position || "").toLowerCase();
  if (normalized.includes("offence") || normalized.includes("forward")) {
    return { goal: 1.2, assist: 0.55, outside: 0.1 };
  }
  if (normalized.includes("midfield")) {
    return { goal: 0.55, assist: 0.85, outside: 0.18 };
  }
  if (normalized.includes("defence")) {
    return { goal: 0.16, assist: 0.2, outside: 0.12 };
  }
  return { goal: 0.015, assist: 0.02, outside: 0.02 };
}

function poissonAtLeastOne(lambda: number) {
  return 1 - Math.exp(-lambda);
}

function poissonAtLeastTwo(lambda: number) {
  return 1 - Math.exp(-lambda) * (1 + lambda);
}

async function footballFetch<T>(path: string, revalidate = 21600): Promise<T> {
  const response = await fetch(`${FOOTBALL_DATA_BASE}${path}`, {
    headers: { "X-Auth-Token": FOOTBALL_DATA_KEY },
    next: { revalidate },
    ...({
      cf: {
        cacheEverything: true,
        cacheTtl: revalidate,
        cacheKey: `${FOOTBALL_DATA_BASE}/cache${path}`,
      },
    } as Record<string, unknown>),
  });
  if (!response.ok) throw new Error(`Football-Data ${response.status}`);
  return response.json() as Promise<T>;
}

function projectTeamPlayers(
  event: Event,
  team: TeamPayload,
  scorers: ScorerEntry[],
  expectedTeamGoals: number,
) {
  const scorerByPlayer = new Map(
    scorers
      .filter((entry) => entry.team.id === team.id)
      .map((entry) => [entry.player.id, entry]),
  );

  const eligible = (team.squad || []).filter(
    (player) =>
      !((player.position || "").toLowerCase().includes("goalkeeper")),
  );

  const weighted = eligible.map((player) => {
    const stats = scorerByPlayer.get(player.id);
    const played = stats?.playedMatches || 0;
    const goals = stats?.goals || 0;
    const assists = stats?.assists || 0;
    const prior = positionPrior(player.position);
    const goalWeight =
      prior.goal + goals * 1.6 + (played ? (goals / played) * 2.2 : 0);
    const assistWeight =
      prior.assist + assists * 1.4 + (played ? (assists / played) * 1.8 : 0);
    return {
      player,
      played,
      goals,
      assists,
      prior,
      goalWeight,
      assistWeight,
    };
  });

  const totalGoalWeight = weighted.reduce((sum, item) => sum + item.goalWeight, 0);
  const totalAssistWeight = weighted.reduce(
    (sum, item) => sum + item.assistWeight,
    0,
  );

  return weighted.map<PlayerProjection>((item) => {
    const expectedGoals =
      totalGoalWeight > 0
        ? expectedTeamGoals * (item.goalWeight / totalGoalWeight)
        : 0;
    const expectedAssists =
      totalAssistWeight > 0
        ? expectedTeamGoals * 0.7 * (item.assistWeight / totalAssistWeight)
        : 0;
    const scorerProbability = poissonAtLeastOne(expectedGoals);
    const sampleReliability =
      item.played >= 2 && item.goals + item.assists >= 1
        ? "high"
        : item.played >= 1
          ? "medium"
          : "low";

    return {
      player_id: item.player.id,
      player: item.player.name,
      team: team.name,
      position: item.player.position || "Unknown",
      tournament_matches: item.played,
      tournament_goals: item.goals,
      tournament_assists: item.assists,
      expected_goals: Number(expectedGoals.toFixed(3)),
      anytime_scorer_probability: Number(scorerProbability.toFixed(4)),
      brace_probability: Number(poissonAtLeastTwo(expectedGoals).toFixed(4)),
      assist_probability: Number(poissonAtLeastOne(expectedAssists).toFixed(4)),
      outside_box_goal_probability: Number(
        (scorerProbability * item.prior.outside).toFixed(4),
      ),
      reliability: sampleReliability,
      evidence: [
        `${item.goals} but(s), ${item.assists} passe(s), ${item.played} match(s) dans le tournoi`,
        `Projection équipe: ${expectedTeamGoals.toFixed(2)} but(s) attendu(s)`,
        `Poste déclaré: ${item.player.position || "non renseigné"}`,
      ],
    };
  });
}

export async function getPlayerInsights(
  eventId: number,
): Promise<PlayerInsights | null> {
  const [event, rawMatch] = await Promise.all([
    getMatch(eventId),
    getRawMatch(eventId),
  ]);
  if (!event?.prediction) return null;

  const homeTeamId = rawMatch.homeTeam.id;
  const awayTeamId = rawMatch.awayTeam.id;
  if (!homeTeamId || !awayTeamId) return null;

  const [homeTeam, awayTeam, scorerPayload] = await Promise.all([
    footballFetch<TeamPayload>(`/teams/${homeTeamId}`),
    footballFetch<TeamPayload>(`/teams/${awayTeamId}`),
    footballFetch<{ scorers: ScorerEntry[]; season?: { startDate?: string } }>(
      "/competitions/WC/scorers?limit=100",
    ),
  ]);

  const lambda = event.prediction.markets?.lambda || { home: 1.25, away: 1.25 };
  const players = [
    ...projectTeamPlayers(
      event,
      homeTeam,
      scorerPayload.scorers || [],
      lambda.home,
    ),
    ...projectTeamPlayers(
      event,
      awayTeam,
      scorerPayload.scorers || [],
      lambda.away,
    ),
  ]
    .sort(
      (a, b) =>
        b.anytime_scorer_probability - a.anytime_scorer_probability,
    )
    .slice(0, 16);

  return {
    event_id: eventId,
    generated_at: new Date().toISOString(),
    methodology:
      "Poisson individuel répartissant les buts attendus de l'équipe selon le poste et la forme mesurée dans le tournoi.",
    data_freshness: {
      tournament_scorers: new Date().toISOString(),
      home_squad: homeTeam.lastUpdated,
      away_squad: awayTeam.lastUpdated,
    },
    players,
    warnings: [
      "Les compositions et minutes probables ne sont pas encore intégrées.",
      "Le but hors surface est une projection expérimentale dérivée du poste, pas une statistique observée.",
      "Les marchés joueurs restent plus volatils que le 1N2 et les totaux.",
    ],
  };
}
