import { NextRequest, NextResponse } from "next/server";
import { createHistorySnapshot } from "@/lib/server/history-cloud";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const hours = Number(request.nextUrl.searchParams.get("hours") || 168);
    return NextResponse.json(await createHistorySnapshot(hours));
  } catch (error) {
    console.error("History snapshot error", error);
    return NextResponse.json(
      { detail: "Impossible de creer le snapshot historique." },
      { status: 502 },
    );
  }
}
