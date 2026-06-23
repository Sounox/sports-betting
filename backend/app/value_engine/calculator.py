"""
Moteur de calcul des value bets.
Compare les probabilités du modèle aux probabilités implicites des bookmakers.
"""
import logging
from typing import Optional
from sqlalchemy.orm import Session

from app.models import OddsSnapshot, Event
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Mapping marché modèle → clé dans les selections bookmaker
MARKET_KEY_MAP = {
    "1x2_home": ("h2h", "home"),
    "1x2_draw": ("h2h", "draw"),
    "1x2_away": ("h2h", "away"),
    "over_under_over_2_5": ("totals", "over"),
    "over_under_under_2_5": ("totals", "under"),
    "over_under_over_1_5": ("totals", "over"),
    "over_under_under_1_5": ("totals", "under"),
    "btts_yes": ("btts", "yes"),
    "btts_no": ("btts", "no"),
}

MARKET_LABELS = {
    "1x2_home": "Victoire domicile",
    "1x2_draw": "Match nul",
    "1x2_away": "Victoire extérieur",
    "over_under_over_2_5": "Over 2.5 buts",
    "over_under_under_2_5": "Under 2.5 buts",
    "over_under_over_1_5": "Over 1.5 buts",
    "over_under_under_1_5": "Under 1.5 buts",
    "btts_yes": "BTTS Oui",
    "btts_no": "BTTS Non",
}


def compute_overround(selections: list[dict]) -> float:
    total = sum(1 / s["price"] for s in selections if s.get("price", 0) > 1)
    return total if total > 0 else 1.0


def compute_fair_prob(implied_prob: float, overround: float) -> float:
    """Probabilité corrigée de la marge bookmaker."""
    return implied_prob / overround if overround > 0 else implied_prob


def compute_edge(model_prob: float, fair_prob: float) -> float:
    return model_prob - fair_prob


def compute_ev(model_prob: float, odds: float) -> float:
    """EV par unité misée."""
    return model_prob * (odds - 1) - (1 - model_prob)


def kelly_stake(model_prob: float, odds: float, fraction: float = 0.25) -> float:
    """Kelly fractionné — toujours < 1."""
    full_kelly = (model_prob * odds - 1) / (odds - 1) if odds > 1 else 0
    return max(0.0, full_kelly * fraction)


def recommendation_score(edge: float, ev: float, confidence: str, data_quality: str) -> float:
    """Score composite 0-100."""
    base = (edge * 100) * 3 + (ev * 100) * 2

    confidence_mult = {"high": 1.2, "medium": 1.0, "low": 0.6}.get(confidence, 1.0)
    quality_mult = {"good": 1.1, "fair": 1.0, "poor": 0.7}.get(data_quality, 1.0)

    score = base * confidence_mult * quality_mult
    return round(min(max(score, 0), 100), 1)


class ValueCalculator:

    def get_best_odds_for_event(self, db: Session, event_id: int) -> dict:
        """Retourne les meilleures cotes disponibles par marché/sélection."""
        snapshots = (
            db.query(OddsSnapshot)
            .filter(OddsSnapshot.event_id == event_id)
            .order_by(OddsSnapshot.captured_at.desc())
            .all()
        )

        best: dict[str, dict] = {}
        for snap in snapshots:
            market = snap.market
            overround = snap.overround or compute_overround(snap.selections)
            for sel in snap.selections:
                key = f"{market}_{sel['key']}"
                price = sel.get("price", 0)
                if price <= 1:
                    continue
                if key not in best or price > best[key]["price"]:
                    implied = 1 / price
                    best[key] = {
                        "price": price,
                        "bookmaker": snap.bookmaker,
                        "implied_prob": implied,
                        "fair_prob": compute_fair_prob(implied, overround),
                        "overround": overround,
                        "market": market,
                        "selection_key": sel["key"],
                        "selection_name": sel.get("name", sel["key"]),
                    }
        return best

    def find_value_bets(
        self,
        db: Session,
        event_id: int,
        model_probs: dict[str, Optional[float]],
        confidence: str = "medium",
        data_quality: str = "fair",
    ) -> list[dict]:
        """
        Compare les probabilités du modèle aux meilleures cotes disponibles.
        Retourne uniquement les sélections avec edge positif significatif.
        """
        best_odds = self.get_best_odds_for_event(db, event_id)
        if not best_odds:
            return []

        value_bets = []

        for model_key, model_prob in model_probs.items():
            if model_prob is None:
                continue

            # Chercher la cote correspondante
            odds_key = None
            for k in best_odds:
                if model_key in k or k in model_key:
                    odds_key = k
                    break

            if not odds_key:
                continue

            odds_data = best_odds[odds_key]
            edge = compute_edge(model_prob, odds_data["fair_prob"])
            ev = compute_ev(model_prob, odds_data["price"])

            if edge < settings.value_bet_min_edge or ev < settings.value_bet_min_ev:
                continue

            rec_score = recommendation_score(edge, ev, confidence, data_quality)
            kelly = kelly_stake(model_prob, odds_data["price"])
            stake_pct = min(kelly, settings.max_stake_pct)

            value_bets.append({
                "market": odds_data["market"],
                "selection": odds_data["selection_name"],
                "model_prob": round(model_prob, 4),
                "fair_prob": round(odds_data["fair_prob"], 4),
                "implied_prob": round(odds_data["implied_prob"], 4),
                "edge": round(edge, 4),
                "ev": round(ev, 4),
                "odds": odds_data["price"],
                "bookmaker": odds_data["bookmaker"],
                "overround": round(odds_data["overround"], 4),
                "recommendation_score": rec_score,
                "kelly_stake_pct": round(kelly, 4),
                "recommended_stake_pct": round(stake_pct, 4),
                "label": MARKET_LABELS.get(model_key, model_key),
                "risk_level": "prudent" if edge < 0.06 else ("balanced" if edge < 0.10 else "aggressive"),
            })

        value_bets.sort(key=lambda x: -x["recommendation_score"])
        return value_bets
