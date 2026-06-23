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

async function fetchNews(event: Event): Promise<NewsSource[]> {
  const query = [
    `"${event.home_team}"`,
    `"${event.away_team}"`,
    "football",
    "World Cup",
    "injury OR lineup OR suspension OR form",
  ].join(" ");
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
        cacheKey: `https://news-cache.sportsbet/${event.id}`,
      },
    } as Record<string, unknown>),
  });
  if (!response.ok) return [];

  const xml = await response.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  return items.slice(0, 12).map((item) => {
    const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    return {
      title: extractTag(item, "title"),
      url: extractTag(item, "link"),
      published_at: extractTag(item, "pubDate") || undefined,
      source: sourceMatch ? decodeXml(sourceMatch[1]) : undefined,
    };
  });
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
Every factual factor must cite one or more valid source indices.
If evidence is weak, say so in data_gaps.

MODEL:
home=${event.prediction?.prob_home}
draw=${event.prediction?.prob_draw}
away=${event.prediction?.prob_away}
expected_goals=${JSON.stringify(event.prediction?.markets?.lambda || {})}

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

  const parsed = parseJson<{
    summary?: string;
    factors?: MatchContext["factors"];
    data_gaps?: string[];
  }>(await runAi(prompt));

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
    factors,
    data_gaps: (parsed.data_gaps || []).slice(0, 8),
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
