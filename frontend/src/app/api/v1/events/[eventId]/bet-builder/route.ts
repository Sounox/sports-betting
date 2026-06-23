import { NextRequest, NextResponse } from "next/server";
import { getMatchBetBuilder } from "@/lib/server/bet-builder-cloud";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await context.params;

  try {
    const result = await getMatchBetBuilder(Number(eventId));
    if (!result) {
      return NextResponse.json(
        { detail: "Propositions indisponibles pour ce match." },
        { status: 404 },
      );
    }
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800",
      },
    });
  } catch (error) {
    console.error("Bet builder error", error);
    return NextResponse.json(
      { detail: "Moteur de propositions temporairement indisponible." },
      { status: 502 },
    );
  }
}
