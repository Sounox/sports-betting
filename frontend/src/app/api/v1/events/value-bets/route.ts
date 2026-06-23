import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  // Les value bets cloud seront activés lorsque le flux de cotes sera migré.
  return NextResponse.json([]);
}
