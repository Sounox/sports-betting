import { NextRequest, NextResponse } from "next/server";
import { getDailyRecommendations } from "@/lib/server/recommendation-cloud";

export const runtime = "nodejs";

function numberParam(request: NextRequest, key: string) {
  const value = request.nextUrl.searchParams.get(key);
  return value == null || value === "" ? undefined : Number(value);
}

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(
      await getDailyRecommendations({
        hours: numberParam(request, "hours"),
        bankroll: numberParam(request, "bankroll"),
        stake: numberParam(request, "stake"),
        target_odds: numberParam(request, "target_odds"),
        max_legs: numberParam(request, "max_legs"),
        min_odds: numberParam(request, "min_odds"),
        max_odds: numberParam(request, "max_odds"),
        risk_level: request.nextUrl.searchParams.get("risk_level") as
          | "prudent"
          | "balanced"
          | "aggressive"
          | undefined,
      }),
    );
  } catch (error) {
    console.error("Recommendations error", error);
    return NextResponse.json(
      { detail: "Impossible de generer les recommandations." },
      { status: 502 },
    );
  }
}
