import { NextRequest, NextResponse } from "next/server";
import { buildMatchContext } from "@/lib/server/ai-cloud";
import { getMatch } from "@/lib/server/football-cloud";
import { getPlayerInsights } from "@/lib/server/player-cloud";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await context.params;
  const cache = (
    globalThis as unknown as { caches?: { default?: Cache } }
  ).caches?.default;
  const cacheKey = new Request(
    `${request.nextUrl.origin}/__cache/ai-context-v4/${eventId}`,
  );

  try {
    const cached = await cache?.match(cacheKey);
    if (cached) return cached;

    const [event, players] = await Promise.all([
      getMatch(Number(eventId)),
      getPlayerInsights(Number(eventId)),
    ]);
    if (!event) {
      return NextResponse.json({ detail: "Match introuvable." }, { status: 404 });
    }

    const result = await buildMatchContext(event, players);
    const response = NextResponse.json(result, {
      headers: {
        "Cache-Control":
          "public, s-maxage=21600, stale-while-revalidate=43200",
      },
    });
    await cache?.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    console.error("Cloud AI context error", error);
    return NextResponse.json(
      { detail: "Contexte IA temporairement indisponible." },
      { status: 502 },
    );
  }
}
