"""
Orchestrateur principal des prédictions football.
Combine Dixon-Coles + Elo + contexte pour produire une prédiction complète.
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from sqlalchemy.orm import Session

from app.models import Event, EventResult, Competition, Team, TeamRating, Prediction
from app.sport_models.dixon_coles import (
    DixonColesPredictor, DixonColesParams, MatchData, fit_dixon_coles
)
from app.sport_models.elo import EloSystem
from app.value_engine.calculator import ValueCalculator

logger = logging.getLogger(__name__)

# Cache en mémoire des modèles entraînés par compétition
_model_cache: dict[int, dict] = {}
_elo_cache: dict[int, EloSystem] = {}


def get_historical_matches(db: Session, competition_id: int, limit: int = 500) -> list[MatchData]:
    """Récupère les matchs terminés pour entraîner le modèle."""
    results = (
        db.query(Event, EventResult)
        .join(EventResult, Event.id == EventResult.event_id)
        .filter(Event.competition_id == competition_id)
        .filter(Event.status == "FINISHED")
        .filter(EventResult.home_score.isnot(None))
        .order_by(Event.scheduled_at.desc())
        .limit(limit)
        .all()
    )

    matches = []
    for event, result in results:
        matches.append(MatchData(
            home_team=event.home_team.name,
            away_team=event.away_team.name,
            home_goals=result.home_score,
            away_goals=result.away_score,
            date=event.scheduled_at,
        ))
    return matches


def build_elo_system(matches: list[MatchData]) -> EloSystem:
    """Reconstruit le système Elo en rejouant tous les matchs chronologiquement."""
    elo = EloSystem()
    sorted_matches = sorted(matches, key=lambda m: m.date)
    for m in sorted_matches:
        elo.update(m.home_team, m.away_team, m.home_goals, m.away_goals)
    return elo


def get_or_train_model(db: Session, competition_id: int, force_retrain: bool = False) -> tuple[DixonColesParams, EloSystem]:
    """
    Retourne le modèle depuis le cache ou l'entraîne si nécessaire.
    Ré-entraîne automatiquement si le modèle date de plus de 24h.
    """
    cached = _model_cache.get(competition_id)
    now = datetime.now(timezone.utc)

    if cached and not force_retrain:
        cached_params = cached.get("params")
        if cached_params is not None:
            age = (now - cached_params.fitted_at).total_seconds() / 3600
            if age < 24:
                return cached_params, _elo_cache.get(competition_id)
        elif competition_id in _elo_cache:
            # Fallback Elo déjà en cache
            return None, _elo_cache[competition_id]

    matches = get_historical_matches(db, competition_id)

    if len(matches) < 5:
        logger.warning(f"Données insuffisantes pour compétition {competition_id}: {len(matches)} matchs")
        return None, None

    logger.info(f"Entraînement modèle compétition {competition_id} sur {len(matches)} matchs")
    try:
        params = fit_dixon_coles(matches, reference_date=now)
    except Exception as e:
        logger.warning(f"Dixon-Coles échoué: {e} — fallback Elo")
        params = None
    elo = build_elo_system(matches)

    _model_cache[competition_id] = {"params": params}
    _elo_cache[competition_id] = elo

    return params, elo


def compute_form_score(db: Session, team_id: int, n_matches: int = 5) -> float:
    """Forme récente : ratio de points sur les n derniers matchs."""
    events = (
        db.query(Event, EventResult)
        .join(EventResult, Event.id == EventResult.event_id)
        .filter(
            (Event.home_team_id == team_id) | (Event.away_team_id == team_id)
        )
        .filter(Event.status == "FINISHED")
        .order_by(Event.scheduled_at.desc())
        .limit(n_matches)
        .all()
    )

    if not events:
        return 0.5

    points = 0
    max_points = 0
    for event, result in events:
        max_points += 3
        if event.home_team_id == team_id:
            if result.winner == "HOME_TEAM":
                points += 3
            elif result.winner == "DRAW":
                points += 1
        else:
            if result.winner == "AWAY_TEAM":
                points += 3
            elif result.winner == "DRAW":
                points += 1

    return points / max_points if max_points > 0 else 0.5


def determine_confidence(
    n_matches: int,
    elo_diff: float,
    form_home: float,
    form_away: float,
    data_quality: str
) -> str:
    if n_matches < 30 or data_quality == "poor":
        return "low"
    if n_matches >= 100 and abs(elo_diff) > 100:
        return "high"
    return "medium"


def determine_data_quality(n_matches: int) -> str:
    if n_matches >= 200:
        return "good"
    elif n_matches >= 80:
        return "fair"
    return "poor"


def predict_match(db: Session, event_id: int, force_retrain: bool = False) -> Optional[Prediction]:
    """
    Prédiction complète d'un match.
    Retourne un objet Prediction prêt à être sauvegardé.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        logger.error(f"Event {event_id} non trouvé")
        return None

    home_name = event.home_team.name
    away_name = event.away_team.name

    params, elo = get_or_train_model(db, event.competition_id, force_retrain)

    warnings = []
    data_quality = "poor"

    if params is None:
        # Fallback Elo pur si pas assez de données Dixon-Coles
        warnings.append("insufficient_data_for_dixon_coles")
        logger.warning(f"Fallback Elo pour {home_name} vs {away_name}")
        elo = EloSystem()
        elo_probs = elo.predict_1x2(home_name, away_name)
        markets = {
            "1x2": elo_probs,
            "double_chance": {
                "1X": round(elo_probs["home"] + elo_probs["draw"], 4),
                "X2": round(elo_probs["draw"] + elo_probs["away"], 4),
                "12": round(elo_probs["home"] + elo_probs["away"], 4),
            },
        }
        prob_home = elo_probs["home"]
        prob_draw = elo_probs["draw"]
        prob_away = elo_probs["away"]
        confidence = "low"
    else:
        predictor = DixonColesPredictor(params)

        # Vérifier si les deux équipes sont dans le modèle
        if home_name not in params.attack:
            warnings.append(f"home_team_unknown_in_model")
            logger.warning(f"{home_name} inconnue dans le modèle")
        if away_name not in params.attack:
            warnings.append(f"away_team_unknown_in_model")

        if warnings:
            # Utiliser Elo comme fallback
            elo_probs = elo.predict_1x2(home_name, away_name) if elo else {"home": 0.4, "draw": 0.25, "away": 0.35}
            markets = {"1x2": elo_probs}
            prob_home = elo_probs["home"]
            prob_draw = elo_probs["draw"]
            prob_away = elo_probs["away"]
            confidence = "low"
        else:
            raw = predictor.predict(home_name, away_name)
            markets = {
                "1x2": raw["1x2"],
                "double_chance": raw["double_chance"],
                "over_under": raw["over_under"],
                "btts": raw["btts"],
                "half_time": raw["half_time"],
                "asian_handicap": raw["asian_handicap"],
                "top_scores": raw["top_scores"],
                "lambda": {
                    "home": raw["lambda_home"],
                    "away": raw["lambda_away"],
                },
            }
            prob_home = raw["1x2"]["home"]
            prob_draw = raw["1x2"]["draw"]
            prob_away = raw["1x2"]["away"]

            data_quality = determine_data_quality(params.n_matches)
            elo_diff = elo.rating_diff(home_name, away_name) if elo else 0

            form_home = compute_form_score(db, event.home_team_id)
            form_away = compute_form_score(db, event.away_team_id)

            confidence = determine_confidence(
                params.n_matches, elo_diff, form_home, form_away, data_quality
            )

            markets["context"] = {
                "elo_home": round(elo.get(home_name), 1) if elo else None,
                "elo_away": round(elo.get(away_name), 1) if elo else None,
                "form_home_last5": round(form_home, 3),
                "form_away_last5": round(form_away, 3),
            }

    # Calculer les value bets si des cotes sont disponibles
    value_calculator = ValueCalculator()
    value_bets = value_calculator.find_value_bets(
        db=db,
        event_id=event_id,
        model_probs={
            "1x2_home": prob_home,
            "1x2_draw": prob_draw,
            "1x2_away": prob_away,
            **{f"over_under_{k}": v for k, v in markets.get("over_under", {}).items()},
            "btts_yes": markets.get("btts", {}).get("yes"),
            "btts_no": markets.get("btts", {}).get("no"),
        }
    )

    prediction = Prediction(
        event_id=event_id,
        model_version="v1.0",
        confidence=confidence,
        data_quality=data_quality,
        warning_flags=warnings,
        prob_home=prob_home,
        prob_draw=prob_draw,
        prob_away=prob_away,
        markets=markets,
        value_bets=value_bets,
        inputs_snapshot={"n_matches_train": params.n_matches if params else 0},
    )

    return prediction
