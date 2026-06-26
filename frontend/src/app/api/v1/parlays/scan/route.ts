import { NextRequest, NextResponse } from "next/server";
import type { MatchParlayScanRequest } from "@/lib/api";
import { generateMultiMatchParlayScanner } from "@/lib/server/bet-builder-cloud";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Partial<MatchParlayScanRequest>;
  const targetOdds = Number(body.target_odds);
  const stake = Number(body.stake);
  const hours = Number(body.hours ?? 168);
  const maxEvents = Number(body.max_events ?? 6);
  const maxLegs = Number(body.max_legs ?? 4);
  const riskProfile =
    body.risk_profile === "prudent" ||
    body.risk_profile === "balanced" ||
    body.risk_profile === "aggressive"
      ? body.risk_profile
      : "balanced";

  if (!Number.isFinite(targetOdds) || targetOdds < 1.1 || targetOdds > 50) {
    return NextResponse.json(
      { detail: "Cote cible invalide. Utilise une cote entre 1.10 et 50." },
      { status: 400 },
    );
  }

  try {
    const result = await generateMultiMatchParlayScanner({
      target_odds: targetOdds,
      stake: Number.isFinite(stake) && stake > 0 ? stake : undefined,
      hours: Number.isFinite(hours) ? hours : 168,
      max_events: Number.isFinite(maxEvents) ? maxEvents : 6,
      max_legs: Number.isFinite(maxLegs) ? maxLegs : 4,
      risk_profile: riskProfile,
      require_french_odds: Boolean(body.require_french_odds),
      bookmaker_only: Boolean(body.bookmaker_only),
      exclude_player_props: Boolean(body.exclude_player_props),
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Multi-match parlay scanner error", error);
    return NextResponse.json(
      { detail: "Scanner multi-match temporairement indisponible." },
      { status: 502 },
    );
  }
}
