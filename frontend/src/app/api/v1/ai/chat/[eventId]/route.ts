import { NextRequest, NextResponse } from "next/server";
import { answerWithAi, buildMatchContext } from "@/lib/server/ai-cloud";
import { getMatch } from "@/lib/server/football-cloud";
import { getPlayerInsights } from "@/lib/server/player-cloud";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await context.params;
    const body = (await request.json()) as {
      message: string;
      history?: Array<{ role: string; content: string }>;
    };
    const [event, players] = await Promise.all([
      getMatch(Number(eventId)),
      getPlayerInsights(Number(eventId)),
    ]);
    if (!event) {
      return NextResponse.json({ detail: "Match introuvable." }, { status: 404 });
    }
    const enrichment = await buildMatchContext(event, players);
    const promptContext = JSON.stringify({
      match: `${event.home_team} vs ${event.away_team}`,
      prediction: event.prediction,
      top_players: players?.players.slice(0, 8),
      sourced_context: enrichment,
    });
    const reply = await answerWithAi(
      body.message,
      promptContext,
      body.history || [],
    );
    return NextResponse.json({
      reply,
      model: "@cf/meta/llama-3.1-8b-instruct",
    });
  } catch (error) {
    console.error("Cloud match chat error", error);
    return NextResponse.json(
      { detail: "Assistant IA temporairement indisponible." },
      { status: 502 },
    );
  }
}
