import { NextRequest, NextResponse } from "next/server";
import { refreshDailyParlayProfile } from "@/lib/server/daily-picks-cloud";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ profileId: string }> },
) {
  const { profileId } = await context.params;
  try {
    return NextResponse.json(await refreshDailyParlayProfile(profileId));
  } catch (error) {
    console.error("Daily parlay profile refresh error", error);
    return NextResponse.json(
      { detail: "Impossible de regenerer ce profil automatique." },
      { status: 404 },
    );
  }
}
