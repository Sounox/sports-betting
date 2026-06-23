"""
Générateur de combinés (parlays).
Construit des combinés selon une cote cible, un niveau de risque et une mise.
Règle absolue : pas de combiné si aucune sélection n'a d'EV positive.
"""
import math
import logging
from dataclasses import dataclass, field
from typing import Optional
from sqlalchemy.orm import Session

from app.models import Prediction, Event
from app.value_engine.calculator import kelly_stake
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class ParlayConfig:
    target_odds: float           # cote totale visée
    stake: float                 # mise souhaitée
    risk_level: str              # prudent / balanced / aggressive
    bankroll: float = 1000.0
    max_legs: int = 5
    min_legs: int = 2
    min_edge_per_leg: float = 0.02
    sport_filter: list[str] = field(default_factory=list)
    tolerance: float = 0.20      # tolérance sur la cote cible (±20%)


@dataclass
class ParlayLeg:
    event_id: int
    home_team: str
    away_team: str
    market: str
    selection: str
    odds: float
    model_prob: float
    fair_prob: float
    edge: float
    ev: float
    bookmaker: str
    recommendation_score: float


@dataclass
class ParlayResult:
    legs: list[ParlayLeg]
    total_odds: float
    theoretical_prob: float
    ev: float
    stake: float
    potential_return: float
    risk_level: str
    warnings: list[str]
    recommended_stake: float
    error: Optional[str] = None

    @property
    def success(self) -> bool:
        return self.error is None


RISK_PROFILES = {
    "prudent":     {"min_legs": 2, "max_legs": 3, "min_edge": 0.04, "max_odds_per_leg": 2.5},
    "balanced":    {"min_legs": 2, "max_legs": 5, "min_edge": 0.03, "max_odds_per_leg": 4.0},
    "aggressive":  {"min_legs": 3, "max_legs": 8, "min_edge": 0.02, "max_odds_per_leg": 8.0},
}


class ParlayGenerator:

    def generate(self, db: Session, config: ParlayConfig) -> ParlayResult:
        profile = RISK_PROFILES.get(config.risk_level, RISK_PROFILES["balanced"])

        # 1. Collecter tous les value bets disponibles
        candidates = self._collect_candidates(db, profile)

        if len(candidates) < profile["min_legs"]:
            return ParlayResult(
                legs=[], total_odds=0, theoretical_prob=0, ev=0,
                stake=config.stake, potential_return=0,
                risk_level=config.risk_level, warnings=[],
                recommended_stake=0,
                error=f"Pas assez de sélections éligibles ({len(candidates)} disponibles, minimum {profile['min_legs']} requis). Élargissez les filtres ou revenez demain."
            )

        # 2. Tri par recommendation_score
        candidates.sort(key=lambda x: -x.recommendation_score)

        # 3. Construction greedy
        selected = []
        current_odds = 1.0
        target_low  = config.target_odds * (1 - config.tolerance)
        target_high = config.target_odds * (1 + config.tolerance)

        for candidate in candidates:
            if len(selected) >= min(config.max_legs, profile["max_legs"]):
                break

            # Anti-corrélation : pas deux sélections du même match
            if any(leg.event_id == candidate.event_id for leg in selected):
                continue

            # Vérifier si l'ajout reste dans la zone cible
            projected_odds = current_odds * candidate.odds
            if projected_odds > target_high:
                continue

            selected.append(candidate)
            current_odds = projected_odds

            # Arrêter si dans la fenêtre cible et min_legs atteint
            if target_low <= current_odds <= target_high and len(selected) >= profile["min_legs"]:
                break

        if len(selected) < profile["min_legs"]:
            return ParlayResult(
                legs=[], total_odds=0, theoretical_prob=0, ev=0,
                stake=config.stake, potential_return=0,
                risk_level=config.risk_level, warnings=[],
                recommended_stake=0,
                error="Impossible de construire un combiné atteignant la cote cible avec des sélections de valeur. Aucun combiné recommandé dans ces conditions."
            )

        # Vérification EV global
        theoretical_prob = math.prod(leg.model_prob for leg in selected)
        total_odds = math.prod(leg.odds for leg in selected)
        total_ev = theoretical_prob * (total_odds - 1) - (1 - theoretical_prob)

        if total_ev < 0:
            return ParlayResult(
                legs=[], total_odds=total_odds, theoretical_prob=theoretical_prob, ev=total_ev,
                stake=config.stake, potential_return=0,
                risk_level=config.risk_level,
                warnings=["negative_ev"],
                recommended_stake=0,
                error=f"EV du combiné négative ({total_ev:.3f}). Ce combiné n'a pas de valeur. Aucune recommandation."
            )

        # Mise recommandée
        avg_edge = sum(leg.edge for leg in selected) / len(selected)
        kelly = kelly_stake(theoretical_prob, total_odds, fraction=settings.kelly_fraction)
        max_stake_parlay = config.bankroll * settings.max_parlay_stake_pct
        recommended_stake = round(min(kelly * config.bankroll, max_stake_parlay, config.stake), 2)

        warnings = self._generate_warnings(selected, total_odds, config.target_odds)

        return ParlayResult(
            legs=selected,
            total_odds=round(total_odds, 2),
            theoretical_prob=round(theoretical_prob, 4),
            ev=round(total_ev, 4),
            stake=config.stake,
            potential_return=round(recommended_stake * total_odds, 2),
            risk_level=config.risk_level,
            warnings=warnings,
            recommended_stake=recommended_stake,
        )

    def _collect_candidates(self, db: Session, profile: dict) -> list[ParlayLeg]:
        """Récupère les value bets des prédictions récentes."""
        from datetime import datetime, timezone, timedelta

        recent_predictions = (
            db.query(Prediction, Event)
            .join(Event, Prediction.event_id == Event.id)
            .filter(Event.scheduled_at >= datetime.now(timezone.utc))
            .filter(Event.scheduled_at <= datetime.now(timezone.utc) + timedelta(hours=48))
            .filter(Event.status == "scheduled")
            .all()
        )

        candidates = []
        for pred, event in recent_predictions:
            for vb in (pred.value_bets or []):
                if vb["edge"] < profile["min_edge"]:
                    continue
                if vb["odds"] > profile["max_odds_per_leg"]:
                    continue
                if vb["ev"] < 0:
                    continue

                candidates.append(ParlayLeg(
                    event_id=event.id,
                    home_team=event.home_team.name,
                    away_team=event.away_team.name,
                    market=vb["market"],
                    selection=vb["selection"],
                    odds=vb["odds"],
                    model_prob=vb["model_prob"],
                    fair_prob=vb["fair_prob"],
                    edge=vb["edge"],
                    ev=vb["ev"],
                    bookmaker=vb["bookmaker"],
                    recommendation_score=vb["recommendation_score"],
                ))

        return candidates

    def _generate_warnings(self, legs: list[ParlayLeg], total_odds: float, target_odds: float) -> list[str]:
        warnings = []
        if abs(total_odds - target_odds) / target_odds > 0.15:
            warnings.append(f"Cote obtenue ({total_odds:.2f}) diffère de la cible ({target_odds:.2f})")
        if len(legs) >= 5:
            warnings.append("Combiné à 5+ sélections : variance très élevée, risque fort")
        low_conf = [l for l in legs if l.recommendation_score < 30]
        if low_conf:
            warnings.append(f"{len(low_conf)} sélection(s) à faible score de recommandation")
        return warnings
