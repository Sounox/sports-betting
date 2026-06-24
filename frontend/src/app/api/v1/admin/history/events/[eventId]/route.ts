import { NextRequest, NextResponse } from "next/server";
import {
  getEventHistory,
  getEventOddsHistory,
} from "@/lib/server/history-cloud";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await context.params;
    const limit = Number(request.nextUrl.searchParams.get("limit") || 50);
    const includeOddsAnalysis =
      request.nextUrl.searchParams.get("odds_analysis") === "true";
    if (includeOddsAnalysis) {
      const includeBase =
        request.nextUrl.searchParams.get("include_base") === "true";
      const oddsHistory = await getEventOddsHistory(Number(eventId), {
        includeBase,
        limit: Math.max(limit * 20, 3000),
      });
      if (request.nextUrl.searchParams.get("analysis_only") === "true") {
        return NextResponse.json(oddsHistory);
      }
      return NextResponse.json({
        ...(await getEventHistory(Number(eventId), Math.min(limit, 100))),
        odds_analysis: oddsHistory,
      });
    }
    return NextResponse.json(await getEventHistory(Number(eventId), limit));
  } catch (error) {
    console.error("Event history error", error);
    return NextResponse.json(
      { detail: "Historique du match indisponible." },
      { status: 502 },
    );
  }
}
