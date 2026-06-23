import { NextRequest, NextResponse } from "next/server";
import { getWorldCupMatches } from "@/lib/server/football-cloud";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  if (code !== "WC") {
    return NextResponse.json(
      {
        detail:
          "Le cloud gratuit traite actuellement la Coupe du monde. Les ligues clubs seront ajoutées avec la base historique D1.",
      },
      { status: 409 },
    );
  }
  const events = await getWorldCupMatches();
  return NextResponse.json({ competition: code, imported: events.length });
}
