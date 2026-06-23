import { NextResponse } from "next/server";
import { getHistoryStatus } from "@/lib/server/history-cloud";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getHistoryStatus());
  } catch (error) {
    console.error("History status error", error);
    return NextResponse.json(
      { detail: "Historique temporairement indisponible." },
      { status: 502 },
    );
  }
}
