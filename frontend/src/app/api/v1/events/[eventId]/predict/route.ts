import { NextRequest, NextResponse } from "next/server";
import { getMatch } from "@/lib/server/football-cloud";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await context.params;
    const event = await getMatch(Number(eventId));
    if (!event?.prediction) {
      return NextResponse.json(
        { detail: "Prédiction indisponible." },
        { status: 404 },
      );
    }
    return NextResponse.json(event.prediction);
  } catch (error) {
    console.error("Cloud prediction error", error);
    return NextResponse.json(
      { detail: "Impossible de calculer cette prédiction." },
      { status: 502 },
    );
  }
}
