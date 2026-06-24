import { NextRequest, NextResponse } from "next/server";
import { getMarketRadar } from "@/lib/server/recommendation-cloud";

export const runtime = "nodejs";

function numberParam(request: NextRequest, key: string) {
  const value = request.nextUrl.searchParams.get(key);
  return value == null || value === "" ? undefined : Number(value);
}

export async function GET(request: NextRequest) {
  try {
    const includeProxy = request.nextUrl.searchParams.get("include_proxy");
    return NextResponse.json(
      await getMarketRadar({
        hours: numberParam(request, "hours"),
        limit: numberParam(request, "limit"),
        include_proxy: includeProxy == null ? undefined : includeProxy !== "false",
      }),
    );
  } catch (error) {
    console.error("Market radar error", error);
    return NextResponse.json(
      { detail: "Impossible de generer le radar marches." },
      { status: 502 },
    );
  }
}
