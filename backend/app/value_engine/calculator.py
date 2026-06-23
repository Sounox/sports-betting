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

        # Collecter toutes les cotes par clé pour filtrer les outliers
        all_prices: dict[str, list[float]] = {}
        raw: dict[str, list[dict]] = {}
        for snap in snapshots:
            if "lay" in snap.market:
                continue  # ignorer les marchés lay (exchange)
            market = snap.market
            overround = snap.overround or compute_overround(snap.selections)
            for sel in snap.selections:
                key = f"{market}_{sel['key']}"
                price = sel.get("price", 0)
                if price <= 1:
                    continue
                all_prices.setdefault(key, []).append(price)
                raw.setdefault(key, []).append({
                    "price": price,
                    "bookmaker": snap.bookmaker,
                    "overround": overround,
                    "market": market,
                    "selection_key": sel["key"],
                    "selection_name": sel.get("name", sel["key"]),
                })

        best: dict[str, dict] = {}
        for key, prices in all_prices.items():
            if not prices:
                continue
            median_price = sorted(prices)[len(prices) // 2]
            # Filtrer les outliers (prix > 3× médiane = données erronées)
            valid = [r for r in raw[key] if r["price"] <= median_price * 3]
            if not valid:
                valid = raw[key]
            best_entry = max(valid, key=lambda r: r["price"])
            implied = 1 / best_entry["price"]
            best[key] = {
                **best_entry,
                "implied_prob": implied,
                "fair_prob": compute_fair_prob(implied, best_entry["overround"]),
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

        # Récupérer les noms d'équipes pour faire correspondre home/away aux clés bookmaker
        event = db.query(Event).filter(Event.id == event_id).first()
        home_key = event.home_team.name.lower().replace(" ", "_") if event else ""
        away_key = event.away_team.name.lower().replace(" ", "_") if event else ""

        def find_odds_key(model_key: str) -> Optional[str]:
            """Cherche la clé bookmaker correspondant à une clé modèle."""
            # Mapping direct h2h home/away/draw par nom d'équipe
            if model_key == "1x2_home":
                for k in best_odds:
                    if k.startswith("h2h_") and any(
                        part in k for part in home_key.split("_")[:2] if len(part) > 3
                    ):
                        return k
                # fallback: première clé h2h non-draw
                for k in best_odds:
                    if k.startswith("h2h_") and "draw" not in k and away_key.split("_")[0][:4] not in k:
                        return k
            elif model_key == "1x2_away":
                for k in best_odds:
                    if k.startswith("h2h_") and any(
                        part in k for part in away_key.split("_")[:2] if len(part) > 3
                    ):
                        return k
            elif model_key == "1x2_draw":
                return "h2h_draw" if "h2h_draw" in best_odds else None
            elif "over" in model_key:
                return next((k for k in best_odds if k.startswith("totals_over")), None)
            elif "under" in model_key:
                return next((k for k in best_odds if k.startswith("totals_under")), None)
            elif "btts" in model_key:
                suffix = "yes" if "yes" in model_key else "no"
                return next((k for k in best_odds if f"btts_{suffix}" in k), None)
            return None

        value_bets = []

        for model_key, model_prob in model_probs.items():
            if model_prob is None:
                continue

            odds_key = find_odds_key(model_key)
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
