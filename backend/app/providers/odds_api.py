"""
Provider The Odds API — free tier 500 req/mois.
https://the-odds-api.com

Stratégie budget zéro :
- On récupère les cotes 2x/jour max pour les matchs du jour et du lendemain.
- On stocke les snapshots en base pour ne pas re-requêter.
- Quota restant affiché dans le dashboard.
"""
import httpx
import logging
from typing import Optional
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

BASE_URL = "https://api.the-odds-api.com/v4"

# Mapping football-data competition → odds_api sport key
SPORT_KEYS = {
    "WC":  "soccer_fifa_world_cup",
    "EC":  "soccer_uefa_euro_2024",
    "CL":  "soccer_uefa_champs_league",
    "PL":  "soccer_epl",
    "FL1": "soccer_france_ligue_one",
    "BL1": "soccer_germany_bundesliga",
    "SA":  "soccer_italy_serie_a",
    "PD":  "soccer_spain_la_liga",
}

# Bookmakers de référence pour les cotes
PREFERRED_BOOKMAKERS = [
    "pinnacle",     # sharp, référence
    "betfair_ex_eu",
    "unibet",
    "bet365",
    "winamax",
    "betclic",
]


class OddsAPIClient:
    def __init__(self):
        self.api_key = settings.odds_api_key
        self._requests_remaining = None
        self._requests_used = None

    def _get(self, path: str, params: dict = None) -> dict | list:
        if not self.api_key:
            logger.warning("Pas de clé The Odds API — cotes indisponibles")
            return []

        url = f"{BASE_URL}{path}"
        all_params = {"apiKey": self.api_key, **(params or {})}

        try:
            response = httpx.get(url, params=all_params, timeout=15)

            # Quota suivi via headers
            self._requests_remaining = response.headers.get("x-requests-remaining")
            self._requests_used = response.headers.get("x-requests-used")

            if self._requests_remaining:
                remaining = int(self._requests_remaining)
                if remaining < 50:
                    logger.warning(f"Quota The Odds API critique : {remaining} requêtes restantes")

            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                logger.error("Clé The Odds API invalide")
            elif e.response.status_code == 422:
                logger.error("Quota The Odds API épuisé")
            raise
        except Exception as e:
            logger.error(f"Erreur Odds API {url}: {e}")
            raise

    def get_sports(self) -> list[dict]:
        return self._get("/sports")

    def get_odds(
        self,
        sport_key: str,
        regions: str = "eu",
        markets: str = "h2h,totals",
        bookmakers: Optional[str] = None,
    ) -> list[dict]:
        params = {
            "regions": regions,
            "markets": markets,
            "oddsFormat": "decimal",
        }
        if bookmakers:
            params["bookmakers"] = bookmakers
        return self._get(f"/sports/{sport_key}/odds", params)

    def get_quota(self) -> dict:
        return {
            "remaining": self._requests_remaining,
            "used": self._requests_used,
        }

    def normalize_odds(self, raw_event: dict) -> dict:
        """Extrait et normalise les cotes d'un événement brut."""
        bookmakers_data = []

        for bm in raw_event.get("bookmakers", []):
            for market in bm.get("markets", []):
                overround = sum(1 / o["price"] for o in market["outcomes"] if o["price"] > 0)
                bookmakers_data.append({
                    "bookmaker": bm["key"],
                    "market": market["key"],
                    "selections": [
                        {
                            "key": o["name"].lower().replace(" ", "_"),
                            "name": o["name"],
                            "price": o["price"],
                            "implied_prob": 1 / o["price"] if o["price"] > 0 else 0,
                            "fair_prob": (1 / o["price"]) / overround if o["price"] > 0 else 0,
                        }
                        for o in market["outcomes"]
                    ],
                    "overround": round(overround, 4),
                    "last_update": market.get("last_update"),
                })

        return {
            "odds_api_id": raw_event["id"],
            "home_team": raw_event["home_team"],
            "away_team": raw_event["away_team"],
            "commence_time": raw_event["commence_time"],
            "sport_key": raw_event["sport_key"],
            "bookmakers": bookmakers_data,
        }

    def get_best_odds(self, normalized_event: dict, market: str = "h2h") -> dict:
        """Retourne les meilleures cotes disponibles sur un marché."""
        best = {}
        for bm in normalized_event["bookmakers"]:
            if bm["market"] != market:
                continue
            for sel in bm["selections"]:
                key = sel["key"]
                if key not in best or sel["price"] > best[key]["price"]:
                    best[key] = {
                        "price": sel["price"],
                        "bookmaker": bm["bookmaker"],
                        "fair_prob": sel["fair_prob"],
                        "implied_prob": sel["implied_prob"],
                    }
        return best


odds_api_client = OddsAPIClient()
