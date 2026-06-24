import { NextRequest, NextResponse } from "next/server";
import { getPlayerInsights } from "@/lib/server/player-cloud";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await context.params;
    const refresh =
      request.nextUrl.searchParams.get("refresh") === "1" ||
      request.nextUrl.searchParams.get("refresh") === "true";
    const insights = await getPlayerInsights(Number(eventId), {
      forceRefresh: refresh,
    });
    if (!insights) {
      return NextResponse.json(
        { detail: "Données joueurs indisponibles." },
        { status: 404 },
      );
    }
    return NextResponse.json(insights, {
      headers: {
        "Cache-Control":
          "public, s-maxage=21600, stale-while-revalidate=43200",
      },
    });
  } catch (error) {
    console.error("Cloud player insights error", error);
    return NextResponse.json(
      { detail: "Impossible de calculer les projections joueurs." },
      { status: 502 },
    );
  }
}
