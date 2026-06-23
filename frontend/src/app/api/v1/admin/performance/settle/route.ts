import { NextResponse } from "next/server";
import { settleBacktestingResults } from "@/lib/server/history-cloud";

export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json(await settleBacktestingResults());
  } catch (error) {
    console.error("Performance settlement error", error);
    return NextResponse.json(
      { detail: "Impossible de mettre a jour le backtesting." },
      { status: 502 },
    );
  }
}
