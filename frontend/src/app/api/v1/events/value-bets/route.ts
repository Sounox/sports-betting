import { NextRequest, NextResponse } from "next/server";
import { getUpcomingMatches } from "@/lib/server/football-cloud";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const minEdge = Number(request.nextUrl.searchParams.get("min_edge") || 0.03);
    const minOdds = Number(request.nextUrl.searchParams.get("min_odds") || 1.2);
    const maxOdds = Number(request.nextUrl.searchParams.get("max_odds") || 5);
    const events = await getUpcomingMatches(24 * 30);
    const bets = events
      .flatMap((event) => event.prediction?.value_bets || [])
      .filter(
        (bet) =>
          bet.edge >= minEdge &&
          bet.odds >= minOdds &&
          bet.odds <= maxOdds,
      )
      .sort((a, b) => b.recommendation_score - a.recommendation_score);
    return NextResponse.json(bets, {
      headers: {
        "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    console.error("Cloud value bets error", error);
    return NextResponse.json(
      { detail: "Impossible de récupérer les value bets." },
      { status: 502 },
    );
  }
}
