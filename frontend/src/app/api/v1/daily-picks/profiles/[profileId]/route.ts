import { NextRequest, NextResponse } from "next/server";
import { getDailyParlayProfile } from "@/lib/server/daily-picks-cloud";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ profileId: string }> },
) {
  const { profileId } = await context.params;
  try {
    const force = request.nextUrl.searchParams.get("force");
    const maxAge = request.nextUrl.searchParams.get("max_age_hours");
    return NextResponse.json(
      await getDailyParlayProfile(profileId, {
        forceRefresh: force === "true" || force === "1",
        maxAgeHours: maxAge ? Number(maxAge) : undefined,
      }),
    );
  } catch (error) {
    console.error("Daily parlay profile error", error);
    return NextResponse.json(
      { detail: "Profil automatique indisponible." },
      { status: 404 },
    );
  }
}
