import { NextRequest, NextResponse } from "next/server";
import { getEventHistory } from "@/lib/server/history-cloud";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await context.params;
    const limit = Number(request.nextUrl.searchParams.get("limit") || 50);
    return NextResponse.json(await getEventHistory(Number(eventId), limit));
  } catch (error) {
    console.error("Event history error", error);
    return NextResponse.json(
      { detail: "Historique du match indisponible." },
      { status: 502 },
    );
  }
}
