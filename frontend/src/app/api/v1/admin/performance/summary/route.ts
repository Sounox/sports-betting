import { NextResponse } from "next/server";
import { getPerformanceSummary } from "@/lib/server/history-cloud";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getPerformanceSummary());
  } catch (error) {
    console.error("Performance summary error", error);
    return NextResponse.json(
      { detail: "Performance temporairement indisponible." },
      { status: 502 },
    );
  }
}
