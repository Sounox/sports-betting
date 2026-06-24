import { NextRequest, NextResponse } from "next/server";
import { getMatch } from "@/lib/server/football-cloud";
import {
  EVENT_CORE_SOCCER_MARKETS,
  EVENT_PLAYER_SOCCER_MARKETS,
  getWorldCupEventOdds,
  getWorldCupOdds,
  matchOddsEvent,
  serializeOdds,
} from "@/lib/server/odds-cloud";

export const runtime = "nodejs";
type EventOddsResult = Awaited<ReturnType<typeof getWorldCupEventOdds>>;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await context.params;
    const [event, odds] = await Promise.all([
      getMatch(Number(eventId)),
      getWorldCupOdds(),
    ]);
    if (!event) {
      return NextResponse.json({ detail: "Match introuvable." }, { status: 404 });
    }
    const oddsEvent = matchOddsEvent(event, odds.events);
    const includeAdvanced =
      request.nextUrl.searchParams.get("advanced") === "1" ||
      request.nextUrl.searchParams.get("advanced") === "true";
    const advancedResults: PromiseSettledResult<EventOddsResult>[] =
      includeAdvanced && oddsEvent?.id
        ? await Promise.allSettled([
            getWorldCupEventOdds(oddsEvent.id, EVENT_CORE_SOCCER_MARKETS),
            getWorldCupEventOdds(oddsEvent.id, EVENT_PLAYER_SOCCER_MARKETS),
          ])
        : [];
    const fulfilledAdvanced = advancedResults.filter(
      (result): result is PromiseFulfilledResult<EventOddsResult> =>
        result.status === "fulfilled",
    );
    const advancedEvents = fulfilledAdvanced.map((result) => result.value.event);
    const snapshots = [
      ...serializeOdds(oddsEvent),
      ...advancedEvents.flatMap((eventOdds) => serializeOdds(eventOdds)),
    ];

    return NextResponse.json(
      snapshots,
      {
        headers: {
          "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    console.error("Cloud odds error", error);
    return NextResponse.json(
      { detail: "Cotes indisponibles." },
      { status: 502 },
    );
  }
}
