"""
Provider Football-Data.org — API gratuite.
Clé gratuite : https://www.football-data.org/client/register
Limite : 10 req/min.

Compétitions supportées gratuitement :
  WC   = FIFA World Cup
  CL   = UEFA Champions League
  PL   = Premier League
  FL1  = Ligue 1
  BL1  = Bundesliga
  SA   = Serie A
  PD   = La Liga
  EC   = UEFA European Championship
  WCQ  = World Cup Qualifiers (selon plan)
"""
import httpx
import time
import logging
from datetime import datetime, date, timezone
from typing import Optional
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

BASE_URL = "https://api.football-data.org/v4"

SUPPORTED_COMPETITIONS = {
    "WC":  {"name": "FIFA World Cup", "country": "World"},
    "EC":  {"name": "UEFA Euro", "country": "Europe"},
    "CL":  {"name": "UEFA Champions League", "country": "Europe"},
    "PL":  {"name": "Premier League", "country": "England"},
    "FL1": {"name": "Ligue 1", "country": "France"},
    "BL1": {"name": "Bundesliga", "country": "Germany"},
    "SA":  {"name": "Serie A", "country": "Italy"},
    "PD":  {"name": "La Liga", "country": "Spain"},
    "PPL": {"name": "Primeira Liga", "country": "Portugal"},
    "DED": {"name": "Eredivisie", "country": "Netherlands"},
    "BSA": {"name": "Brasileirão", "country": "Brazil"},
}


class FootballDataClient:
    def __init__(self):
        self.api_key = settings.football_data_api_key
        self.headers = {"X-Auth-Token": self.api_key} if self.api_key else {}
        self._last_request = 0.0

    def _get(self, path: str, params: dict = None) -> dict:
        # Rate limit : 10 req/min → attendre 6s entre requêtes si pas de clé
        elapsed = time.time() - self._last_request
        wait = 6.0 if not self.api_key else 0.5
        if elapsed < wait:
            time.sleep(wait - elapsed)

        url = f"{BASE_URL}{path}"
        try:
            response = httpx.get(url, headers=self.headers, params=params, timeout=15)
            self._last_request = time.time()

            if response.status_code == 429:
                logger.warning("Rate limit football-data.org, attente 60s")
                time.sleep(60)
                return self._get(path, params)

            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error {e.response.status_code} on {url}")
            raise
        except Exception as e:
            logger.error(f"Error fetching {url}: {e}")
            raise

    def get_competitions(self) -> list[dict]:
        data = self._get("/competitions")
        return data.get("competitions", [])

    def get_matches(
        self,
        competition_code: str,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        status: Optional[str] = None,
        season: Optional[int] = None,
    ) -> list[dict]:
        params = {}
        if date_from:
            params["dateFrom"] = date_from.isoformat()
        if date_to:
            params["dateTo"] = date_to.isoformat()
        if status:
            params["status"] = status
        if season:
            params["season"] = season

        data = self._get(f"/competitions/{competition_code}/matches", params)
        return data.get("matches", [])

    def get_match(self, match_id: int) -> dict:
        return self._get(f"/matches/{match_id}")

    def get_standings(self, competition_code: str, season: int = None) -> list[dict]:
        params = {"season": season} if season else {}
        data = self._get(f"/competitions/{competition_code}/standings", params)
        return data.get("standings", [])

    def get_teams(self, competition_code: str, season: int = None) -> list[dict]:
        params = {"season": season} if season else {}
        data = self._get(f"/competitions/{competition_code}/teams", params)
        return data.get("teams", [])

    def get_today_matches(self) -> list[dict]:
        today = date.today()
        data = self._get("/matches", {"dateFrom": today.isoformat(), "dateTo": today.isoformat()})
        return data.get("matches", [])

    def normalize_match(self, raw: dict) -> dict:
        """Convertit un match brut en format interne."""
        return {
            "fd_id": raw["id"],
            "competition_code": raw["competition"]["code"],
            "home_team": {
                "fd_id": raw["homeTeam"]["id"],
                "name": raw["homeTeam"]["name"],
                "short_name": raw["homeTeam"].get("shortName", ""),
                "tla": raw["homeTeam"].get("tla", ""),
            },
            "away_team": {
                "fd_id": raw["awayTeam"]["id"],
                "name": raw["awayTeam"]["name"],
                "short_name": raw["awayTeam"].get("shortName", ""),
                "tla": raw["awayTeam"].get("tla", ""),
            },
            "scheduled_at": raw["utcDate"],
            "status": raw["status"],
            "matchday": raw.get("matchday"),
            "stage": raw.get("stage"),
            "season": raw.get("season", {}).get("startDate", "")[:4],
            "score": {
                "home": raw["score"]["fullTime"].get("home"),
                "away": raw["score"]["fullTime"].get("away"),
                "home_ht": raw["score"]["halfTime"].get("home"),
                "away_ht": raw["score"]["halfTime"].get("away"),
                "winner": raw["score"].get("winner"),  # HOME_TEAM, AWAY_TEAM, DRAW
            },
        }


football_data_client = FootballDataClient()
