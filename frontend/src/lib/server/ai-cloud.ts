import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Event, MatchContext, PlayerInsights } from "@/lib/api";

const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";

interface NewsSource {
  title: string;
  url: string;
  published_at?: string;
  source?: string;
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function extractTag(xml: string, tag: string) {
  const match = xml.match(
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"),
  );
  return match ? decodeXml(match[1]) : "";
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isRecentEnough(publishedAt?: string) {
  if (!publishedAt) return false;
  const timestamp = Date.parse(publishedAt);
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp <= 21 * 24 * 60 * 60 * 1000;
}

function isRelevantNews(source: NewsSource, event: Event) {
  const title = normalizeText(source.title);
  const home = normalizeText(event.home_team);
  const away = normalizeText(event.away_team);
  const mentionsHome = home && title.includes(home);
  const mentionsAway = away && title.includes(away);
  const contextWords = [
    "world cup",
    "prediction",
    "lineup",
    "injury",
    "suspension",
    "team news",
    "odds",
    "preview",
  ];
  const hasContext = contextWords.some((word) => title.includes(word));

  return isRecentEnough(source.published_at) && hasContext && (mentionsHome || mentionsAway);
}

async function fetchNews(event: Event): Promise<NewsSource[]> {
  const queries = [
    `"${event.home_team}" "${event.away_team}" football World Cup`,
    `"${event.home_team}" football injury lineup suspension form`,
    `"${event.away_team}" football injury lineup suspension form`,
  ];
  const seen = new Set<string>();
  const sources: NewsSource[] = [];

  for (const query of queries) {
    const url = new URL("https://news.google.com/rss/search");
    url.searchParams.set("q", query);
    url.searchParams.set("hl", "en-US");
    url.searchParams.set("gl", "US");
    url.searchParams.set("ceid", "US:en");

    const response = await fetch(url, {
      next: { revalidate: 10800 },
      ...({
        cf: {
          cacheEverything: true,
          cacheTtl: 10800,
          cacheKey: `https://news-cache.sportsbet/${event.id}/${query}`,
        },
      } as Record<string, unknown>),
    });
    if (!response.ok) continue;

    const xml = await response.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
    for (const item of items.slice(0, 8)) {
      const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
      const source = {
        title: extractTag(item, "title"),
        url: extractTag(item, "link"),
        published_at: extractTag(item, "pubDate") || undefined,
        source: sourceMatch ? decodeXml(sourceMatch[1]) : undefined,
      };
      const key = source.url || source.title;
      if (!key || seen.has(key) || !isRelevantNews(source, event)) continue;
      seen.add(key);
      sources.push(source);
    }
  }

  return sources.slice(0, 12);
}

async function runAi(prompt: string) {
  const { env } = getCloudflareContext();
  const ai = (env as unknown as { AI?: { run: Function } }).AI;
  if (!ai) throw new Error("Workers AI binding unavailable");
  const result = (await ai.run(AI_MODEL, {
    prompt,
    max_tokens: 900,
    temperature: 0.15,
  })) as { response?: string };
  return result.response || "";
}

function parseJson<T>(raw: string): T {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}") + 1;
  if (start < 0 || end <= start) throw new Error("AI response is not JSON");
  return JSON.parse(raw.slice(start, end)) as T;
}

function pct(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function predictionConfidence(event: Event) {
  return event.prediction?.confidence || "medium";
}

function internalFactors(
  event: Event,
  playerInsights: PlayerInsights | null,
): MatchContext["factors"] {
  const prediction = event.prediction;
  const lambda = prediction?.markets?.lambda || {};
  const overUnder = prediction?.markets?.over_under || {};
  const btts = prediction?.markets?.btts || {};
  const topScores = prediction?.markets?.top_scores || [];
  const bestPlayers = (playerInsights?.players || []).slice(0, 3);
  const valueBets = (prediction?.value_bets || []).slice(0, 3);
  const favorite =
    (prediction?.prob_home || 0) >= (prediction?.prob_away || 0)
      ? {
          team: event.home_team,
          prob: prediction?.prob_home,
          impact: "positive_home" as const,
        }
      : {
          team: event.away_team,
          prob: prediction?.prob_away,
          impact: "positive_away" as const,
        };
  const factors: MatchContext["factors"] = [];

  if (prediction) {
    factors.push({
      text: `Selon le modele interne, ${favorite.team} est favori avec ${pct(favorite.prob)}, contre ${pct(prediction.prob_draw)} pour le nul.`,
      impact: favorite.impact,
      confidence: predictionConfidence(event),
      source_indices: [],
    });
  }

  if (typeof lambda.home === "number" && typeof lambda.away === "number") {
    factors.push({
      text: `Projection buts attendus: ${event.home_team} ${lambda.home.toFixed(2)} - ${event.away_team} ${lambda.away.toFixed(2)}, soit ${(lambda.home + lambda.away).toFixed(2)} buts au total.`,
      impact: "neutral",
      confidence: "medium",
      source_indices: [],
    });
  }

  if (typeof overUnder.over_2_5 === "number" && typeof btts.yes === "number") {
    factors.push({
      text: `Lecture buts: Over 2.5 a ${pct(overUnder.over_2_5)}, Under 2.5 a ${pct(overUnder.under_2_5)}, BTTS Oui a ${pct(btts.yes)}.`,
      impact: "neutral",
      confidence: "medium",
      source_indices: [],
    });
  }

  if (Array.isArray(topScores) && topScores.length) {
    const scores = topScores
      .slice(0, 3)
      .map((score: { score: string; probability?: number; prob?: number }) =>
        `${score.score} (${pct(score.probability ?? score.prob)})`,
      )
      .join(", ");
    factors.push({
      text: `Scores les plus probables du simulateur: ${scores}.`,
      impact: "neutral",
      confidence: "medium",
      source_indices: [],
    });
  }

  if (bestPlayers.length) {
    factors.push({
      text: `Joueurs les plus exposes au but: ${bestPlayers
        .map((player) => `${player.player} ${pct(player.anytime_scorer_probability)}`)
        .join(", ")}.`,
      impact: "neutral",
      confidence: bestPlayers.some((player) => player.reliability === "medium")
        ? "medium"
        : "low",
      source_indices: [],
    });
  }

  if (valueBets.length) {
    factors.push({
      text: `Value bets detectes: ${valueBets
        .map((bet) => `${bet.label} @ ${bet.odds} (${bet.bookmaker}, edge ${pct(bet.edge)})`)
        .join("; ")}.`,
      impact: "neutral",
      confidence: predictionConfidence(event),
      source_indices: [],
    });
  }

  factors.push({
    text: "Risque principal: compositions officielles, blessures recentes et rotations ne sont pas encore confirmees.",
    impact: "risk",
    confidence: "high",
    source_indices: [],
  });

  return factors.slice(0, 8);
}

function internalDataGaps(sources: NewsSource[]) {
  const gaps = [
    "Compositions officielles et minutes probables non confirmees.",
    "Blessures, suspensions et rotation non appliquees sans source fiable.",
    "Les projections joueurs sont derivees du modele et de la forme tournoi, pas encore de donnees xG joueur completes.",
  ];

  if (sources.length < 0) {
    gaps.unshift(
      "Aucune source externe recente exploitable: le brief est une analyse interne, pas une verification d'actualite.",
    );
  }

  return gaps;
}

function fallbackContext(
  event: Event,
  playerInsights: PlayerInsights | null,
  sources: NewsSource[] = [],
): MatchContext {
  const prediction = event.prediction;
  const favorite =
    (prediction?.prob_home || 0) >= (prediction?.prob_away || 0)
      ? `${event.home_team} (${pct(prediction?.prob_home)})`
      : `${event.away_team} (${pct(prediction?.prob_away)})`;

  return {
    generated_at: new Date().toISOString(),
    summary: `Brief interne: le modele place ${favorite} comme option la plus probable, avec un nul a ${pct(prediction?.prob_draw)}. L'analyse combine probabilites, buts attendus, cotes disponibles et projections joueurs. Les actualites ne modifient pas encore la prediction tant qu'elles ne sont pas confirmees par une source fiable.`,
    factors: internalFactors(event, playerInsights),
    data_gaps: internalDataGaps(sources),
    sources,
  };
}

export async function buildMatchContext(
  event: Event,
  playerInsights: PlayerInsights | null,
): Promise<MatchContext> {
  const sources = await fetchNews(event);
  const sourceText = sources.length
    ? sources
        .map(
          (source, index) =>
            `[${index}] ${source.title} | ${source.source || "Unknown"} | ${source.published_at || "Unknown date"} | ${source.url}`,
        )
        .join("\n")
    : "NO_SOURCES";
  const topPlayers = (playerInsights?.players || [])
    .slice(0, 8)
    .map(
      (player) =>
        `${player.player} (${player.team}): ${player.tournament_goals} buts, ${player.tournament_assists} passes, P(buteur) ${(player.anytime_scorer_probability * 100).toFixed(1)}%`,
    )
    .join("\n");

  if (!sources.length) {
    return {
      generated_at: new Date().toISOString(),
      summary:
        "Aucune source récente vérifiable n'a été trouvée. Le contexte LLM n'est pas appliqué aux probabilités.",
      factors: [],
      data_gaps: [
        "Actualités, blessures et compositions non confirmées par une source récente.",
      ],
      sources: [],
    };
  }

  const prompt = `You are a sports data extraction engine, not a tipster.
Analyze ONLY the evidence below for ${event.home_team} vs ${event.away_team}.
Do not use unstated knowledge. Do not invent injuries, lineups, motivation or player status.
For model-derived factors, use source_indices: [] and clearly say "Selon le modele".
For news-derived factual factors, cite one or more valid source indices.
If evidence is weak, say so in data_gaps.

MODEL:
home=${event.prediction?.prob_home}
draw=${event.prediction?.prob_draw}
away=${event.prediction?.prob_away}
expected_goals=${JSON.stringify(event.prediction?.markets?.lambda || {})}
markets=${JSON.stringify(event.prediction?.markets || {})}
value_bets=${JSON.stringify((event.prediction?.value_bets || []).slice(0, 5))}

PLAYER MODEL:
${topPlayers || "No player model available"}

NEWS SOURCES:
${sourceText}

Return strict JSON:
{
  "summary": "French summary, max 3 sentences",
  "factors": [
    {
      "text": "French factual statement",
      "impact": "positive_home|positive_away|neutral|risk",
      "confidence": "low|medium|high",
      "source_indices": [0]
    }
  ],
  "data_gaps": ["French missing-data statement"]
}`;

  let parsed: {
    summary?: string;
    factors?: MatchContext["factors"];
    data_gaps?: string[];
  };

  try {
    parsed = parseJson(await runAi(prompt));
  } catch (error) {
    console.error("AI context generation failed, using fallback", error);
    return fallbackContext(event, playerInsights, sources);
  }

  const factors = (parsed.factors || [])
    .filter(
      (factor) =>
        factor.text &&
        Array.isArray(factor.source_indices) &&
        factor.source_indices.every(
          (index) =>
            Number.isInteger(index) && index >= 0 && index < sources.length,
        ),
    )
    .slice(0, 8);

  return {
    generated_at: new Date().toISOString(),
    summary:
      parsed.summary ||
      "Les sources récentes ne permettent pas de dégager un facteur contextuel robuste.",
    factors: factors.length ? factors : internalFactors(event, playerInsights),
    data_gaps: [
      ...(parsed.data_gaps || []),
      ...internalDataGaps(sources),
    ].slice(0, 8),
    sources,
  };
}

export async function answerWithAi(
  message: string,
  context: string,
  history: Array<{ role: string; content: string }> = [],
) {
  const compactHistory = history
    .slice(-6)
    .map((item) => `${item.role}: ${item.content}`)
    .join("\n");
  const prompt = `Tu es l'assistant d'un outil probabiliste de paris sportifs.
Réponds en français, en moins de 8 phrases.
Ne garantis jamais un gain. Ne présente pas une projection comme un fait.
Base-toi uniquement sur le contexte fourni. Si la donnée manque, dis-le.

CONTEXTE:
${context}

HISTORIQUE:
${compactHistory}

QUESTION:
${message}`;
  return runAi(prompt);
}
