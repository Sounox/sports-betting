import { NextResponse } from "next/server";
import { getUpcomingMatches } from "@/lib/server/football-cloud";

export const runtime = "nodejs";

export async function POST() {
  try {
    const events = await getUpcomingMatches(24 * 30);
    return NextResponse.json({
      computed: events.filter((event) => event.prediction).length,
      model: "cloud-elo-poisson-1.0",
    });
  } catch (error) {
    console.error("Cloud predictions refresh error", error);
    return NextResponse.json(
      { detail: "Calcul des prédictions impossible." },
      { status: 502 },
    );
  }
}
