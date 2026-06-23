import { NextResponse } from "next/server";
import {
  getUpcomingMatches,
  getWorldCupMatches,
} from "@/lib/server/football-cloud";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [events, upcoming] = await Promise.all([
      getWorldCupMatches(),
      getUpcomingMatches(24 * 30),
    ]);
    return NextResponse.json({
      events_total: events.length,
      events_scheduled: upcoming.length,
      predictions_computed: upcoming.length,
      odds_snapshots: 0,
      competitions_active: 1,
      odds_api_quota: {},
    });
  } catch (error) {
    console.error("Cloud status error", error);
    return NextResponse.json(
      { detail: "Statut indisponible." },
      { status: 502 },
    );
  }
}
