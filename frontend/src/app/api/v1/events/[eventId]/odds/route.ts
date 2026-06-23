import { NextRequest, NextResponse } from "next/server";
import { getMatch } from "@/lib/server/football-cloud";
import {
  getWorldCupOdds,
  matchOddsEvent,
  serializeOdds,
} from "@/lib/server/odds-cloud";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await context.params;
    const [event, odds] = await Promise.all([
      getMatch(Number(eventId)),
      getWorldCupOdds(),
    ]);
    if (!event) {
      return NextResponse.json({ detail: "Match introuvable." }, { status: 404 });
    }
    return NextResponse.json(
      serializeOdds(matchOddsEvent(event, odds.events)),
      {
        headers: {
          "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    console.error("Cloud odds error", error);
    return NextResponse.json(
      { detail: "Cotes indisponibles." },
      { status: 502 },
    );
  }
}
