import { NextRequest, NextResponse } from "next/server";
import { getDailyPicksSnapshot } from "@/lib/server/daily-picks-cloud";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const force = request.nextUrl.searchParams.get("force");
    const maxAge = request.nextUrl.searchParams.get("max_age_hours");
    return NextResponse.json(
      await getDailyPicksSnapshot({
        forceRefresh: force === "true" || force === "1",
        maxAgeHours: maxAge ? Number(maxAge) : undefined,
      }),
    );
  } catch (error) {
    console.error("Daily picks error", error);
    return NextResponse.json(
      { detail: "Impossible de charger les daily picks." },
      { status: 502 },
    );
  }
}
