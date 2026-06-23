"""
Système Elo adapté au football.
Complète Dixon-Coles pour la comparaison des niveaux et la confiance.
"""
import math
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime


K_FACTOR = 40.0          # sensibilité de l'Elo (plus haut = réactif)
HOME_ADVANTAGE = 65.0    # en points Elo
INITIAL_ELO = 1500.0
DRAW_WEIGHT = 0.5        # un nul = 0.5 points pour chaque équipe

# Ratings FIFA-based pré-seedés (classement FIFA juin 2025, converti en Elo ~1500-2000)
# Formule approximative : Elo = 1500 + (200 - FIFA_rank) * 2.5  (cap à top 10 → ~2000)
FIFA_SEED_RATINGS: dict[str, float] = {
    "Argentina": 2050, "France": 1980, "England": 1960, "Belgium": 1940,
    "Brazil": 1930, "Portugal": 1910, "Netherlands": 1890, "Spain": 1880,
    "Germany": 1860, "Italy": 1850, "Croatia": 1800, "Morocco": 1780,
    "Colombia": 1760, "Uruguay": 1750, "Japan": 1730, "United States": 1700,
    "Mexico": 1690, "Senegal": 1680, "Denmark": 1670, "Switzerland": 1660,
    "Austria": 1640, "Sweden": 1620, "Poland": 1610, "South Korea": 1600,
    "Australia": 1590, "Ecuador": 1580, "Peru": 1570, "Ukraine": 1560,
    "Serbia": 1550, "Czech Republic": 1545, "Czechia": 1545,
    "Turkey": 1540, "Chile": 1530, "Algeria": 1520, "Egypt": 1515,
    "Scotland": 1510, "Norway": 1505, "Romania": 1500, "Hungary": 1495,
    "Slovakia": 1490, "Canada": 1510, "Venezuela": 1480, "Bolivia": 1460,
    "Ghana": 1500, "Cameroon": 1490, "Nigeria": 1480, "Ivory Coast": 1470,
    "Tunisia": 1460, "South Africa": 1450, "Congo DR": 1440, "Zambia": 1430,
    "Mali": 1440, "Burkina Faso": 1435, "Guinea": 1430, "Gabon": 1420,
    "Saudi Arabia": 1490, "Iran": 1480, "South Korea": 1500, "Japan": 1530,
    "Australia": 1490, "Qatar": 1430, "Uzbekistan": 1440,
    "Panama": 1450, "Honduras": 1440, "Costa Rica": 1470,
    "Bosnia-Herzegovina": 1490, "Slovenia": 1480, "Albania": 1475,
    "Armenia": 1460, "Georgia": 1465, "Iceland": 1490,
    "Haiti": 1400, "Cuba": 1380, "Jamaica": 1430,
    "New Zealand": 1380, "Fiji": 1320,
}


@dataclass
class EloSystem:
    ratings: dict[str, float] = field(default_factory=dict)
    use_fifa_seeds: bool = True

    def __post_init__(self):
        if self.use_fifa_seeds:
            for team, rating in FIFA_SEED_RATINGS.items():
                if team not in self.ratings:
                    self.ratings[team] = rating

    def get(self, team: str) -> float:
        return self.ratings.get(team, INITIAL_ELO)

    def expected(self, team_a: str, team_b: str, home_advantage: bool = True) -> float:
        """Probabilité de victoire de team_a (avec home advantage si applicable)."""
        rating_a = self.get(team_a) + (HOME_ADVANTAGE if home_advantage else 0)
        rating_b = self.get(team_b)
        return 1 / (1 + 10 ** ((rating_b - rating_a) / 400))

    def update(self, home_team: str, away_team: str, home_score: int, away_score: int):
        """Met à jour les ratings après un match."""
        exp_home = self.expected(home_team, away_team, home_advantage=True)
        exp_away = 1 - exp_home

        if home_score > away_score:
            result_home, result_away = 1.0, 0.0
        elif home_score == away_score:
            result_home, result_away = DRAW_WEIGHT, DRAW_WEIGHT
        else:
            result_home, result_away = 0.0, 1.0

        # Facteur de marge de victoire (optionnel, améliore la précision)
        goal_diff = abs(home_score - away_score)
        margin_multiplier = math.log(goal_diff + 1) + 1 if goal_diff > 0 else 1.0
        margin_multiplier = min(margin_multiplier, 2.5)  # cap

        k = K_FACTOR * margin_multiplier

        self.ratings[home_team] = self.get(home_team) + k * (result_home - exp_home)
        self.ratings[away_team] = self.get(away_team) + k * (result_away - exp_away)

    def predict_1x2(self, home_team: str, away_team: str) -> dict[str, float]:
        """
        Estimation 1X2 depuis l'Elo.
        Approximation : P(draw) ≈ 0.3 × ajusté, P(home/away) proportionnel à P(win).
        """
        prob_home_win_no_draw = self.expected(home_team, away_team)

        # Calibration des probabilités 1X2 depuis l'Elo
        # Source : calibration empirique sur données historiques football
        raw_h = prob_home_win_no_draw
        raw_a = 1 - prob_home_win_no_draw

        # Probabilité de nul : haute quand les équipes sont proches
        draw_base = 0.28
        closeness = 1 - abs(raw_h - raw_a)
        prob_draw = draw_base * (0.5 + 0.5 * closeness)
        prob_draw = min(prob_draw, 0.35)

        remaining = 1 - prob_draw
        prob_home = raw_h * remaining
        prob_away = raw_a * remaining

        total = prob_home + prob_draw + prob_away
        return {
            "home": round(prob_home / total, 4),
            "draw": round(prob_draw / total, 4),
            "away": round(prob_away / total, 4),
        }

    def rating_diff(self, home_team: str, away_team: str) -> float:
        return self.get(home_team) - self.get(away_team)

    def confidence_from_diff(self, diff: float) -> str:
        """Niveau de confiance basé sur l'écart Elo."""
        abs_diff = abs(diff)
        if abs_diff > 200:
            return "high"
        elif abs_diff > 100:
            return "medium"
        return "low"
