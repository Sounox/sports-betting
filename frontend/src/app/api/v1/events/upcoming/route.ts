import { NextRequest, NextResponse } from "next/server";
import { getUpcomingMatches } from "@/lib/server/football-cloud";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const hours = Number(request.nextUrl.searchParams.get("hours") || 48);
    return NextResponse.json(await getUpcomingMatches(hours));
  } catch (error) {
    console.error("Cloud upcoming events error", error);
    return NextResponse.json(
      { detail: "Impossible de récupérer les matchs pour le moment." },
      { status: 502 },
    );
  }
}
