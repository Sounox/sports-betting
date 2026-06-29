import { NextResponse } from "next/server";
import { scanAutomatedAlerts } from "@/lib/server/alerts-cloud";

export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json(await scanAutomatedAlerts());
  } catch (error) {
    console.error("Automated alerts scan error", error);
    return NextResponse.json(
      { detail: "Impossible d'analyser les nouvelles alertes." },
      { status: 502 },
    );
  }
}
