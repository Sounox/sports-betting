import { NextRequest, NextResponse } from "next/server";
import { getMatch } from "@/lib/server/football-cloud";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await context.params;
    const event = await getMatch(Number(eventId));
    if (!event) {
      return NextResponse.json(
        { detail: "Événement non trouvé." },
        { status: 404 },
      );
    }
    return NextResponse.json(event);
  } catch (error) {
    console.error("Cloud event detail error", error);
    return NextResponse.json(
      { detail: "Impossible de récupérer ce match." },
      { status: 502 },
    );
  }
}
