import { NextRequest, NextResponse } from "next/server";
import { runAutomatedDataRefresh } from "@/lib/server/history-cloud";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const modeParam = request.nextUrl.searchParams.get("mode");
    const triggerParam = request.nextUrl.searchParams.get("trigger");
    const warmLimitParam = request.nextUrl.searchParams.get("warm_limit");
    const hoursParam = request.nextUrl.searchParams.get("hours");
    const mode = modeParam === "fast" ? "fast" : "full";
    const trigger = triggerParam === "cron" ? "cron" : "manual";

    return NextResponse.json(
      await runAutomatedDataRefresh({
        origin: request.nextUrl.origin,
        mode,
        trigger,
        hours: hoursParam ? Number(hoursParam) : undefined,
        warmLimit: warmLimitParam ? Number(warmLimitParam) : undefined,
      }),
    );
  } catch (error) {
    console.error("Automated data refresh error", error);
    return NextResponse.json(
      { detail: "Impossible de lancer la mise a jour automatique." },
      { status: 502 },
    );
  }
}
