import { NextRequest, NextResponse } from "next/server";
import {
  getAutomatedAlerts,
  markAutomatedAlertsRead,
} from "@/lib/server/alerts-cloud";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const limit = Number(request.nextUrl.searchParams.get("limit") || 30);
    return NextResponse.json(await getAutomatedAlerts({ limit }));
  } catch (error) {
    console.error("Automated alerts error", error);
    return NextResponse.json(
      { detail: "Impossible de charger les alertes." },
      { status: 502 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      id?: number;
      all?: boolean;
    };
    return NextResponse.json(await markAutomatedAlertsRead(body));
  } catch (error) {
    console.error("Automated alerts read error", error);
    return NextResponse.json(
      { detail: "Impossible de mettre à jour les alertes." },
      { status: 502 },
    );
  }
}
