import { NextResponse } from "next/server";
import {
  getUpcomingMatches,
  getWorldCupMatches,
} from "@/lib/server/football-cloud";
import { getHistoryStatus } from "@/lib/server/history-cloud";
import { getWorldCupOdds } from "@/lib/server/odds-cloud";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [events, upcoming, odds] = await Promise.all([
      getWorldCupMatches(),
      getUpcomingMatches(24 * 30),
      getWorldCupOdds(),
    ]);
    const history = await getHistoryStatus().catch((error) => {
      console.warn("History status unavailable", error);
      return {
        enabled: false,
        message: "Historique indisponible temporairement.",
      };
    });

    return NextResponse.json({
      events_total: events.length,
      events_scheduled: upcoming.length,
      predictions_computed: upcoming.length,
      odds_snapshots: odds.events.reduce(
        (sum, event) => sum + event.bookmakers.length,
        0,
      ),
      competitions_active: 1,
      odds_api_quota: odds.quota,
      history,
    });
  } catch (error) {
    console.error("Cloud status error", error);
    return NextResponse.json(
      { detail: "Statut indisponible." },
      { status: 502 },
    );
  }
}
