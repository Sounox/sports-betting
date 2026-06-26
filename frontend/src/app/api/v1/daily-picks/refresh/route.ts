import { NextRequest, NextResponse } from "next/server";
import { refreshDailyPicksSnapshot } from "@/lib/server/daily-picks-cloud";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const triggerParam = request.nextUrl.searchParams.get("trigger");
    const trigger =
      triggerParam === "cron" || triggerParam === "auto" ? triggerParam : "manual";
    return NextResponse.json(await refreshDailyPicksSnapshot({ trigger }));
  } catch (error) {
    console.error("Daily picks refresh error", error);
    return NextResponse.json(
      { detail: "Impossible de regenerer les daily picks." },
      { status: 502 },
    );
  }
}
