import { NextResponse } from "next/server";
import { getTodayMatches } from "@/lib/server/football-cloud";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getTodayMatches());
  } catch (error) {
    console.error("Cloud today events error", error);
    return NextResponse.json(
      { detail: "Impossible de récupérer les matchs du jour." },
      { status: 502 },
    );
  }
}
