"""
Modèle Dixon-Coles pour le football.

Principe :
- Chaque équipe a deux paramètres : attack (α) et defense (δ)
- Buts attendus : λ_home = exp(α_home + δ_away + γ)  où γ = home advantage
- Buts attendus : λ_away = exp(α_away + δ_home)
- Distribution Poisson corrigée pour les faibles scores (correction rho)
- Pondération temporelle : les matchs récents comptent plus (decay xi)

Référence : Dixon & Coles (1997) "Modelling Association Football Scores
and Inefficiencies in the Football Betting Market"
"""
try:
    import numpy as np
    from scipy.stats import poisson
    from scipy.optimize import minimize
    _HAS_SCIPY = True
except ImportError:
    _HAS_SCIPY = False
    np = None
from datetime import datetime, date, timezone
import math
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

XI = 0.0018  # decay temporel (~1 an de demi-vie)
MAX_GOALS = 10  # buts max simulés


@dataclass
class MatchData:
    home_team: str
    away_team: str
    home_goals: int
    away_goals: int
    date: datetime
    weight: float = 1.0  # calculé après initialisation


@dataclass
class DixonColesParams:
    teams: list[str]
    attack: dict[str, float]
    defense: dict[str, float]
    home_advantage: float
    rho: float  # correction faibles scores
    fitted_at: Optional[datetime] = None
    n_matches: int = 0


def time_weight(match_date: datetime, reference_date: datetime, xi: float = XI) -> float:
    """Pondération exponentielle décroissante selon l'ancienneté."""
    if match_date.tzinfo is None:
        match_date = match_date.replace(tzinfo=timezone.utc)
    if reference_date.tzinfo is None:
        reference_date = reference_date.replace(tzinfo=timezone.utc)
    days = (reference_date - match_date).days
    return math.exp(-xi * max(days, 0))


def dixon_coles_tau(home_goals: int, away_goals: int, lam_h: float, lam_a: float, rho: float) -> float:
    """Correction Dixon-Coles pour les faibles scores."""
    if home_goals == 0 and away_goals == 0:
        return 1 - lam_h * lam_a * rho
    elif home_goals == 0 and away_goals == 1:
        return 1 + lam_h * rho
    elif home_goals == 1 and away_goals == 0:
        return 1 + lam_a * rho
    elif home_goals == 1 and away_goals == 1:
        return 1 - rho
    return 1.0


def neg_log_likelihood(params_flat: np.ndarray, teams: list[str], matches: list[MatchData]) -> float:
    """Fonction de coût à minimiser."""
    n = len(teams)
    attack  = {t: params_flat[i]     for i, t in enumerate(teams)}
    defense = {t: params_flat[n + i] for i, t in enumerate(teams)}
    home_adv = params_flat[2 * n]
    rho      = params_flat[2 * n + 1]

    total_ll = 0.0
    for m in matches:
        if m.home_team not in attack or m.away_team not in attack:
            continue

        lam_h = math.exp(attack[m.home_team] + defense[m.away_team] + home_adv)
        lam_a = math.exp(attack[m.away_team] + defense[m.home_team])

        tau = dixon_coles_tau(m.home_goals, m.away_goals, lam_h, lam_a, rho)
        if tau <= 0:
            tau = 1e-10

        ll = (
            math.log(tau)
            + m.home_goals * math.log(lam_h) - lam_h - math.lgamma(m.home_goals + 1)
            + m.away_goals * math.log(lam_a) - lam_a - math.lgamma(m.away_goals + 1)
        )
        total_ll += m.weight * ll

    return -total_ll


def fit_dixon_coles(matches: list[MatchData], reference_date: datetime = None) -> DixonColesParams:
    if not _HAS_SCIPY:
        raise ImportError("scipy est requis pour entraîner le modèle. Installez-le avec : pip install scipy numpy")
    """
    Entraîne le modèle Dixon-Coles sur un jeu de matchs.
    matches : liste de MatchData avec date et buts
    reference_date : date de référence pour le time-weighting (défaut = maintenant)
    """
    if not matches:
        raise ValueError("Aucun match pour entraîner le modèle")

    if reference_date is None:
        reference_date = datetime.now(timezone.utc)

    # Calcul des poids temporels
    for m in matches:
        m.weight = time_weight(m.date, reference_date)

    # Extraire les équipes uniques
    teams = sorted(set(
        t for m in matches for t in [m.home_team, m.away_team]
    ))
    n = len(teams)

    logger.info(f"Entraînement Dixon-Coles sur {len(matches)} matchs, {n} équipes")

    # Initialisation des paramètres
    # attack et defense initiaux à 0, home_adv à 0.25, rho à -0.1
    x0 = np.zeros(2 * n + 2)
    x0[2 * n] = 0.25   # home advantage
    x0[2 * n + 1] = -0.1  # rho

    # Contrainte : somme des attack = 0 (identifiabilité)
    constraints = [{"type": "eq", "fun": lambda x: np.sum(x[:n])}]

    result = minimize(
        neg_log_likelihood,
        x0,
        args=(teams, matches),
        method="L-BFGS-B",
        options={"maxiter": 200, "ftol": 1e-9},
    )

    if not result.success:
        logger.warning(f"Convergence partielle: {result.message}")

    params_flat = result.x
    return DixonColesParams(
        teams=teams,
        attack={t: params_flat[i]     for i, t in enumerate(teams)},
        defense={t: params_flat[n + i] for i, t in enumerate(teams)},
        home_advantage=params_flat[2 * n],
        rho=params_flat[2 * n + 1],
        fitted_at=datetime.now(timezone.utc),
        n_matches=len(matches),
    )


class DixonColesPredictor:
    """Calcule toutes les probabilités à partir d'un modèle entraîné."""

    def __init__(self, params: DixonColesParams):
        self.params = params

    def lambdas(self, home_team: str, away_team: str) -> tuple[float, float]:
        """Retourne les buts attendus (λ_home, λ_away)."""
        p = self.params
        if home_team not in p.attack:
            raise ValueError(f"Équipe inconnue: {home_team}")
        if away_team not in p.attack:
            raise ValueError(f"Équipe inconnue: {away_team}")

        lam_h = math.exp(p.attack[home_team] + p.defense[away_team] + p.home_advantage)
        lam_a = math.exp(p.attack[away_team] + p.defense[home_team])
        return lam_h, lam_a

    def score_matrix(self, home_team: str, away_team: str, max_goals: int = MAX_GOALS) -> np.ndarray:
        """Matrice des probabilités de score [home_goals x away_goals]."""
        lam_h, lam_a = self.lambdas(home_team, away_team)
        matrix = np.outer(
            poisson.pmf(range(max_goals + 1), lam_h),
            poisson.pmf(range(max_goals + 1), lam_a),
        )
        # Correction Dixon-Coles
        for h in range(2):
            for a in range(2):
                matrix[h, a] *= dixon_coles_tau(h, a, lam_h, lam_a, self.params.rho)

        # Renormaliser
        matrix /= matrix.sum()
        return matrix

    def predict(self, home_team: str, away_team: str) -> dict:
        """Prédiction complète d'un match."""
        matrix = self.score_matrix(home_team, away_team)
        lam_h, lam_a = self.lambdas(home_team, away_team)
        n = matrix.shape[0]

        # 1x2
        prob_home = float(np.sum(np.tril(matrix, -1)))
        prob_draw = float(np.sum(np.diag(matrix)))
        prob_away = float(np.sum(np.triu(matrix, 1)))

        # Over/Under
        goals_matrix = np.add.outer(range(n), range(n))
        ou = {}
        for threshold in [0.5, 1.5, 2.5, 3.5, 4.5]:
            over = float(np.sum(matrix[goals_matrix > threshold]))
            ou[f"over_{str(threshold).replace('.', '_')}"] = over
            ou[f"under_{str(threshold).replace('.', '_')}"] = 1 - over

        # BTTS
        prob_btts_yes = float(np.sum(matrix[1:, 1:]))
        prob_btts_no = 1 - prob_btts_yes

        # Top 15 scores les plus probables
        scores = []
        for h in range(min(n, 8)):
            for a in range(min(n, 8)):
                scores.append({
                    "score": f"{h}-{a}",
                    "home_goals": h,
                    "away_goals": a,
                    "prob": round(float(matrix[h, a]), 4),
                })
        scores.sort(key=lambda x: -x["prob"])
        top_scores = scores[:15]

        # Mi-temps (approximation : utiliser λ/2 pour chaque période)
        lam_ht_h = lam_h / 2
        lam_ht_a = lam_a / 2
        matrix_ht = np.outer(
            poisson.pmf(range(n), lam_ht_h),
            poisson.pmf(range(n), lam_ht_a),
        )
        matrix_ht /= matrix_ht.sum()
        ht_home = float(np.sum(np.tril(matrix_ht, -1)))
        ht_draw = float(np.sum(np.diag(matrix_ht)))
        ht_away = float(np.sum(np.triu(matrix_ht, 1)))

        # Double chance
        dc_1x = prob_home + prob_draw
        dc_x2 = prob_draw + prob_away
        dc_12 = prob_home + prob_away

        # Handicap asiatique -0.5 / +0.5
        ah_home = prob_home  # home gagne = couvre -0.5
        ah_away = prob_away + prob_draw  # away gagne ou nul = couvre +0.5

        return {
            "home_team": home_team,
            "away_team": away_team,
            "lambda_home": round(lam_h, 3),
            "lambda_away": round(lam_a, 3),
            "1x2": {
                "home": round(prob_home, 4),
                "draw": round(prob_draw, 4),
                "away": round(prob_away, 4),
            },
            "double_chance": {
                "1X": round(dc_1x, 4),
                "X2": round(dc_x2, 4),
                "12": round(dc_12, 4),
            },
            "over_under": ou,
            "btts": {
                "yes": round(prob_btts_yes, 4),
                "no": round(prob_btts_no, 4),
            },
            "half_time": {
                "home": round(ht_home, 4),
                "draw": round(ht_draw, 4),
                "away": round(ht_away, 4),
            },
            "asian_handicap": {
                "home_minus_0_5": round(ah_home, 4),
                "away_plus_0_5": round(ah_away, 4),
            },
            "top_scores": top_scores,
        }
