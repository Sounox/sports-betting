import { NextRequest, NextResponse } from "next/server";
import { answerWithAi } from "@/lib/server/ai-cloud";
import { getUpcomingMatches } from "@/lib/server/football-cloud";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      message: string;
      history?: Array<{ role: string; content: string }>;
    };
    const events = await getUpcomingMatches(72);
    const valueBets = events.flatMap(
      (event) => event.prediction?.value_bets || [],
    );
    const context = `${events.length} matchs à venir.
Top value bets:
${valueBets
  .slice(0, 8)
  .map(
    (bet) =>
      `${bet.match}: ${bet.label}, cote ${bet.odds}, edge ${(bet.edge * 100).toFixed(1)}%`,
  )
  .join("\n")}`;
    const reply = await answerWithAi(
      body.message,
      context,
      body.history || [],
    );
    return NextResponse.json({
      reply,
      model: "@cf/meta/llama-3.1-8b-instruct",
    });
  } catch (error) {
    console.error("Cloud general chat error", error);
    return NextResponse.json(
      { detail: "Assistant IA temporairement indisponible." },
      { status: 502 },
    );
  }
}
