export type OddsSourceKind =
  | "french_bookmaker"
  | "global_bookmaker"
  | "model"
  | "proxy";

export interface FrenchBookmakerProfile {
  id: string;
  displayName: string;
  aliases: string[];
  priority: number;
  country: "FR";
}

export const FRENCH_BOOKMAKER_PROFILES: FrenchBookmakerProfile[] = [
  {
    id: "winamax",
    displayName: "Winamax (FR)",
    aliases: ["winamax", "winamaxfr"],
    priority: 0,
    country: "FR",
  },
  {
    id: "betclic",
    displayName: "Betclic (FR)",
    aliases: ["betclic", "betclicfr"],
    priority: 1,
    country: "FR",
  },
  {
    id: "unibet_fr",
    displayName: "Unibet (FR)",
    aliases: ["unibetfr", "unibetfrance"],
    priority: 2,
    country: "FR",
  },
  {
    id: "pmu",
    displayName: "PMU (FR)",
    aliases: ["pmu", "pmufr"],
    priority: 3,
    country: "FR",
  },
  {
    id: "parions_sport",
    displayName: "Parions Sport",
    aliases: ["parionssport", "parions", "fdj", "francaisedesjeux"],
    priority: 4,
    country: "FR",
  },
];

export const FRENCH_BOOKMAKER_PRIORITY = FRENCH_BOOKMAKER_PROFILES.map(
  (profile) => profile.displayName,
);

export function normalizeBookmakerName(value?: string | null) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function identifyFrenchBookmaker(
  bookmaker?: string | null,
  bookmakerKey?: string | null,
) {
  const normalizedName = normalizeBookmakerName(bookmaker);
  const normalizedKey = normalizeBookmakerName(bookmakerKey);
  if (!normalizedName && !normalizedKey) return null;

  return (
    FRENCH_BOOKMAKER_PROFILES.find((profile) =>
      profile.aliases.some((alias) => {
        const normalizedAlias = normalizeBookmakerName(alias);
        return (
          normalizedName.includes(normalizedAlias) ||
          normalizedKey.includes(normalizedAlias)
        );
      }),
    ) || null
  );
}

export function bookmakerPreferenceRank(
  bookmaker?: string | null,
  bookmakerKey?: string | null,
) {
  const profile = identifyFrenchBookmaker(bookmaker, bookmakerKey);
  if (profile) return profile.priority;
  const normalized = normalizeBookmakerName(`${bookmaker || ""}${bookmakerKey || ""}`);
  if (normalized.includes("fr")) return 20;
  return 100;
}

export function isFrenchBookmaker(
  bookmaker?: string | null,
  bookmakerKey?: string | null,
) {
  return bookmakerPreferenceRank(bookmaker, bookmakerKey) < 100;
}

export function bookmakerSourceMeta(
  bookmaker?: string | null,
  bookmakerKey?: string | null,
) {
  const profile = identifyFrenchBookmaker(bookmaker, bookmakerKey);
  if (profile) {
    return {
      odds_source: "french_bookmaker" as const,
      is_french_bookmaker: true,
      bookmaker_priority: profile.priority,
      bookmaker_country: profile.country,
      bookmaker_display: profile.displayName,
      bookmaker_source_label: `${profile.displayName} via agregateur de cotes`,
    };
  }

  return {
    odds_source: "global_bookmaker" as const,
    is_french_bookmaker: false,
    bookmaker_priority: 100,
    bookmaker_country: undefined,
    bookmaker_display: bookmaker || "Bookmaker",
    bookmaker_source_label: bookmaker
      ? `${bookmaker} - fallback global`
      : "Fallback bookmaker global",
  };
}

export function preferBookmakerOdd<
  T extends {
    price: number;
    bookmakerTitle?: string;
    bookmaker?: string;
    bookmakerKey?: string;
    bookmaker_key?: string;
  },
>(left: T, right: T) {
  const leftRank = bookmakerPreferenceRank(
    left.bookmakerTitle || left.bookmaker,
    left.bookmakerKey || left.bookmaker_key,
  );
  const rightRank = bookmakerPreferenceRank(
    right.bookmakerTitle || right.bookmaker,
    right.bookmakerKey || right.bookmaker_key,
  );
  if (leftRank !== rightRank) return leftRank < rightRank ? left : right;
  return left.price >= right.price ? left : right;
}

export function summarizeFrenchOddsCoverage(
  snapshots: Array<{
    bookmaker: string;
    bookmaker_key?: string;
    market: string;
    is_french_bookmaker?: boolean;
  }>,
) {
  const french = snapshots.filter(
    (snapshot) =>
      snapshot.is_french_bookmaker ??
      isFrenchBookmaker(snapshot.bookmaker, snapshot.bookmaker_key),
  );
  const global = snapshots.filter((snapshot) => !french.includes(snapshot));
  const frenchBookmakers = Array.from(
    new Set(
      french.map((snapshot) =>
        bookmakerSourceMeta(snapshot.bookmaker, snapshot.bookmaker_key)
          .bookmaker_display,
      ),
    ),
  ).sort(
    (a, b) => bookmakerPreferenceRank(a) - bookmakerPreferenceRank(b),
  );
  const globalBookmakers = Array.from(
    new Set(global.map((snapshot) => snapshot.bookmaker)),
  ).sort();
  const availableMarkets = Array.from(
    new Set(french.map((snapshot) => snapshot.market)),
  ).sort();
  const missingPriorityBookmakers = FRENCH_BOOKMAKER_PROFILES.filter(
    (profile) => !frenchBookmakers.includes(profile.displayName),
  ).map((profile) => profile.displayName);
  const availability: "good" | "partial" | "none" =
    french.length >= 8
      ? "good"
      : french.length > 0
        ? "partial"
        : "none";

  return {
    availability,
    french_markets: french.length,
    global_markets: global.length,
    french_bookmakers: frenchBookmakers,
    global_bookmakers: globalBookmakers.slice(0, 10),
    available_markets: availableMarkets,
    missing_priority_bookmakers: missingPriorityBookmakers,
    note:
      availability === "good"
        ? "Bonne couverture FR sur ce match."
        : availability === "partial"
          ? "Couverture FR partielle: certains marches utilisent un fallback global."
          : "Aucune cote FR detectee: les cotes affichees viennent du marche global ou du modele.",
  };
}
