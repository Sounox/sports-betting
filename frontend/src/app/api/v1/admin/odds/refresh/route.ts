import { NextResponse } from "next/server";
import { getWorldCupOdds } from "@/lib/server/odds-cloud";

export const runtime = "nodejs";

export async function POST() {
  try {
    const odds = await getWorldCupOdds();
    return NextResponse.json({
      refreshed: true,
      events: odds.events.length,
      quota: odds.quota,
      note: "Le cache protège le quota et se renouvelle au maximum toutes les 4 heures.",
    });
  } catch (error) {
    console.error("Cloud odds refresh error", error);
    return NextResponse.json(
      { detail: "Rafraîchissement des cotes impossible." },
      { status: 502 },
    );
  }
}
