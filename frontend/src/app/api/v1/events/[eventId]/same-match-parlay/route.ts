import { NextRequest, NextResponse } from "next/server";
import { generateSameMatchParlay } from "@/lib/server/bet-builder-cloud";
import type { MatchParlayRequest } from "@/lib/api";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Partial<MatchParlayRequest>;
  const targetOdds = Number(body.target_odds);
  const stake = body.stake == null ? undefined : Number(body.stake);
  const requestedMaxLegs = Number(body.max_legs ?? 4);
  const maxLegs =
    Number.isFinite(requestedMaxLegs) && requestedMaxLegs >= 1
      ? Math.min(5, Math.max(1, Math.trunc(requestedMaxLegs)))
      : 4;

  if (!Number.isFinite(targetOdds) || targetOdds < 1.1 || targetOdds > 50) {
    return NextResponse.json(
      { detail: "Cote cible invalide. Utilise une cote entre 1.10 et 50." },
      { status: 400 },
    );
  }

  try {
    const result = await generateSameMatchParlay(Number(eventId), {
      target_odds: targetOdds,
      stake: Number.isFinite(stake) ? stake : undefined,
      max_legs: maxLegs,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Same match parlay error", error);
    return NextResponse.json(
      { detail: "Generation du combine temporairement indisponible." },
      { status: 502 },
    );
  }
}
