from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_
from datetime import datetime, timezone, timedelta, date
from typing import Optional

from app.database import get_db
from app.models import Event, EventResult, Prediction, OddsSnapshot, Competition, Team

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/today")
def get_today_events(
    sport: str = "football",
    db: Session = Depends(get_db),
):
    """Matchs du jour avec prédictions et value bets."""
    now = datetime.now(timezone.utc)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)

    events = (
        db.query(Event)
        .options(
            joinedload(Event.home_team),
            joinedload(Event.away_team),
            joinedload(Event.competition),
            joinedload(Event.result),
            joinedload(Event.prediction),
        )
        .filter(Event.scheduled_at.between(start, end))
        .order_by(Event.scheduled_at)
        .all()
    )
    return [_serialize_event(e) for e in events]


@router.get("/upcoming")
def get_upcoming_events(
    hours: int = 48,
    competition_code: Optional[str] = None,
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    end = now + timedelta(hours=hours)

    UPCOMING_STATUSES = ["scheduled", "SCHEDULED", "TIMED", "IN_PLAY", "PAUSED"]
    q = (
        db.query(Event)
        .options(
            joinedload(Event.home_team),
            joinedload(Event.away_team),
            joinedload(Event.competition),
            joinedload(Event.prediction),
        )
        .filter(Event.status.in_(UPCOMING_STATUSES))
        .filter(Event.scheduled_at.between(now, end))
    )

    if competition_code:
        q = q.join(Competition).filter(Competition.fd_code == competition_code)

    events = q.order_by(Event.scheduled_at).all()
    return [_serialize_event(e) for e in events]


@router.get("/value-bets")
def get_value_bets(
    min_edge: float = Query(0.03, ge=0, le=1),
    min_odds: float = Query(1.2),
    max_odds: float = Query(5.0),
    confidence: Optional[str] = None,
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
):
    """Value bets triés par recommendation_score décroissant."""
    now = datetime.now(timezone.utc)

    predictions = (
        db.query(Prediction)
        .join(Event)
        .options(joinedload(Prediction.event).joinedload(Event.home_team))
        .options(joinedload(Prediction.event).joinedload(Event.away_team))
        .options(joinedload(Prediction.event).joinedload(Event.competition))
        .filter(Event.scheduled_at > now)
        .filter(Event.status.in_(["scheduled", "SCHEDULED", "TIMED"]))
        .all()
    )

    all_vbs = []
    for pred in predictions:
        for vb in (pred.value_bets or []):
            if vb.get("edge", 0) < min_edge:
                continue
            if not (min_odds <= vb.get("odds", 0) <= max_odds):
                continue
            if confidence and pred.confidence != confidence:
                continue
            all_vbs.append({
                "event_id": pred.event_id,
                "match": f"{pred.event.home_team.name} vs {pred.event.away_team.name}",
                "competition": pred.event.competition.name,
                "scheduled_at": pred.event.scheduled_at.isoformat(),
                "confidence": pred.confidence,
                "data_quality": pred.data_quality,
                **vb,
            })

    all_vbs.sort(key=lambda x: -x.get("recommendation_score", 0))
    return all_vbs[:limit]


@router.get("/{event_id}")
def get_event_detail(event_id: int, db: Session = Depends(get_db)):
    event = (
        db.query(Event)
        .options(
            joinedload(Event.home_team),
            joinedload(Event.away_team),
            joinedload(Event.competition),
            joinedload(Event.result),
            joinedload(Event.prediction),
        )
        .filter(Event.id == event_id)
        .first()
    )
    if not event:
        raise HTTPException(404, "Événement non trouvé")
    return _serialize_event(event, detailed=True)


@router.get("/{event_id}/odds")
def get_event_odds(event_id: int, db: Session = Depends(get_db)):
    """Toutes les cotes disponibles pour un match."""
    snapshots = (
        db.query(OddsSnapshot)
        .filter(OddsSnapshot.event_id == event_id)
        .order_by(OddsSnapshot.captured_at.desc())
        .limit(200)
        .all()
    )
    return [
        {
            "bookmaker": s.bookmaker,
            "market": s.market,
            "selections": s.selections,
            "overround": s.overround,
            "captured_at": s.captured_at.isoformat(),
            "is_closing": s.is_closing,
        }
        for s in snapshots
    ]


@router.post("/{event_id}/predict")
def trigger_prediction(event_id: int, db: Session = Depends(get_db)):
    """Lance ou relance une prédiction pour un match."""
    from app.sport_models.football_predictor import predict_match

    existing = db.query(Prediction).filter(Prediction.event_id == event_id).first()
    if existing:
        db.delete(existing)
        db.flush()

    pred = predict_match(db, event_id, force_retrain=False)
    if not pred:
        raise HTTPException(500, "Impossible de calculer la prédiction (données insuffisantes)")

    db.add(pred)
    db.commit()
    db.refresh(pred)
    return _serialize_prediction(pred)


def _serialize_event(event: Event, detailed: bool = False) -> dict:
    base = {
        "id": event.id,
        "home_team": event.home_team.name,
        "away_team": event.away_team.name,
        "competition": event.competition.name,
        "competition_code": event.competition.fd_code,
        "scheduled_at": event.scheduled_at.isoformat(),
        "status": event.status,
        "matchday": event.matchday,
        "stage": event.stage,
    }

    if event.result:
        base["result"] = {
            "home_score": event.result.home_score,
            "away_score": event.result.away_score,
            "winner": event.result.winner,
        }

    if event.prediction:
        base["prediction"] = _serialize_prediction(event.prediction)

    return base


def _serialize_prediction(pred: Prediction) -> dict:
    return {
        "id": pred.id,
        "model_version": pred.model_version,
        "predicted_at": pred.predicted_at.isoformat(),
        "confidence": pred.confidence,
        "data_quality": pred.data_quality,
        "warning_flags": pred.warning_flags,
        "prob_home": pred.prob_home,
        "prob_draw": pred.prob_draw,
        "prob_away": pred.prob_away,
        "markets": pred.markets,
        "value_bets": pred.value_bets,
    }
