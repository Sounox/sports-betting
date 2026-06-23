"""
Scraper de cotes en fallback quand The Odds API est épuisée.
Sources : Flashscore (résultats), Winamax (cotes FR).

Usage : données personnelles uniquement.
Respecter les robots.txt et les CGU.
"""
import httpx
import json
import re
import logging
from bs4 import BeautifulSoup
from typing import Optional
import time

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Accept": "application/json, text/html",
}


class WinamaxScraper:
    """
    Winamax expose une API JSON non-officielle via ses pages sport.
    Les cotes sont dans une balise JSON dans le HTML.
    """
    BASE = "https://www.winamax.fr/paris-sportifs/sports"

    def get_football_odds(self, competition_path: str = "1/7/2") -> list[dict]:
        """
        competition_path exemples :
          1/7/2   = Ligue 1
          1/7/198 = Ligue des Champions
          1/7/196 = Coupe du Monde
        """
        url = f"{self.BASE}/{competition_path}"
        try:
            resp = httpx.get(url, headers=HEADERS, timeout=20, follow_redirects=True)
            resp.raise_for_status()

            # Winamax injecte les données dans window.PRELOADED_STATE
            match = re.search(r"window\.PRELOADED_STATE\s*=\s*({.+?});\s*</script>", resp.text, re.DOTALL)
            if not match:
                logger.warning("PRELOADED_STATE non trouvé sur Winamax")
                return []

            data = json.loads(match.group(1))
            return self._extract_odds(data)

        except Exception as e:
            logger.error(f"Erreur scraping Winamax: {e}")
            return []

    def _extract_odds(self, data: dict) -> list[dict]:
        matches = []
        try:
            events = data.get("matches", {}).get("data", {}).get("matches", {})
            bets = data.get("bets", {}).get("data", {}).get("bets", {})

            for match_id, match in events.items():
                if match.get("sport") != "FOOTBALL":
                    continue

                competitors = match.get("competitors", [])
                if len(competitors) < 2:
                    continue

                home = competitors[0].get("name", "")
                away = competitors[1].get("name", "")

                # Chercher les cotes 1N2
                match_bets = [b for b in bets.values() if str(b.get("matchId")) == str(match_id)]
                h2h_bet = next((b for b in match_bets if b.get("betType") == "SINGLE" and "1N2" in str(b.get("title", ""))), None)

                if not h2h_bet:
                    continue

                outcomes = h2h_bet.get("outcomes", [])
                if len(outcomes) >= 3:
                    odds_home = outcomes[0].get("odds", 0)
                    odds_draw = outcomes[1].get("odds", 0)
                    odds_away = outcomes[2].get("odds", 0)

                    matches.append({
                        "home_team": home,
                        "away_team": away,
                        "commence_time": match.get("matchStart"),
                        "bookmaker": "winamax",
                        "market": "h2h",
                        "odds": {
                            "home": odds_home / 100 if odds_home > 100 else odds_home,
                            "draw": odds_draw / 100 if odds_draw > 100 else odds_draw,
                            "away": odds_away / 100 if odds_away > 100 else odds_away,
                        }
                    })

        except Exception as e:
            logger.error(f"Erreur extraction Winamax: {e}")

        return matches


class FlashscoreResultsScraper:
    """
    Récupère les résultats récents depuis Flashscore pour alimenter
    le modèle sans dépendre de l'API Football-Data.
    """
    BASE = "https://www.flashscore.com"

    def get_league_results(self, league_url: str, pages: int = 3) -> list[dict]:
        """
        league_url exemple: /football/france/ligue-1/results/
        """
        results = []
        for page in range(pages):
            url = f"{self.BASE}{league_url}"
            try:
                resp = httpx.get(url, headers=HEADERS, timeout=20)
                resp.raise_for_status()
                soup = BeautifulSoup(resp.text, "lxml")

                # Flashscore charge dynamiquement via JS
                # On parse ce qui est dans le HTML initial
                events = soup.select(".event__match")
                for ev in events:
                    try:
                        home = ev.select_one(".event__participant--home")
                        away = ev.select_one(".event__participant--away")
                        score_home = ev.select_one(".event__score--home")
                        score_away = ev.select_one(".event__score--away")
                        date_el = ev.select_one(".event__time")

                        if home and away and score_home and score_away:
                            results.append({
                                "home_team": home.text.strip(),
                                "away_team": away.text.strip(),
                                "home_score": int(score_home.text.strip()),
                                "away_score": int(score_away.text.strip()),
                                "date": date_el.text.strip() if date_el else None,
                            })
                    except Exception:
                        continue

                time.sleep(2)  # politesse

            except Exception as e:
                logger.error(f"Erreur scraping Flashscore: {e}")
                break

        return results


winamax_scraper = WinamaxScraper()
flashscore_scraper = FlashscoreResultsScraper()
