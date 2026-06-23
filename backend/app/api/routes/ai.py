"""
Routes IA — chat et enrichissement contextuel via Groq/Llama.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import Event, Prediction, Competition
from app.providers.groq_client import chat_about_match, general_chat, enrich_match_context

router = APIRouter(prefix="/ai", tags=["ai"])


class ChatMessage(BaseModel):
    message: str
    history: list[dict] = []


class ChatResponse(BaseModel):
    reply: str
    model: str = "llama-3.3-70b-versatile"


@router.post("/chat")
def global_chat(body: ChatMessage, db: Session = Depends(get_db)) -> ChatResponse:
    """Chat général sur l'outil et les paris."""
    from app.models import OddsSnapshot
    context = {
        "events_total": db.query(Event).count(),
        "predictions_computed": db.query(Prediction).count(),
        "odds_snapshots": db.query(OddsSnapshot).count(),
    }
    reply = general_chat(body.message, context, body.history)
    if not reply:
        raise HTTPException(503, "LLM indisponible")
    return ChatResponse(reply=reply)


@router.post("/chat/{event_id}")
def match_chat(event_id: int, body: ChatMessage, db: Session = Depends(get_db)) -> ChatResponse:
    """Chat sur un match spécifique."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(404, "Événement non trouvé")

    pred = db.query(Prediction).filter(Prediction.event_id == event_id).first()
    prediction_dict = {}
    if pred:
        prediction_dict = {
            "prob_home": pred.prob_home,
            "prob_draw": pred.prob_draw,
            "prob_away": pred.prob_away,
            "confidence": pred.confidence,
            "value_bets": pred.value_bets or [],
            "markets": pred.markets or {},
        }

    reply = chat_about_match(
        home_team=event.home_team.name,
        away_team=event.away_team.name,
        competition=event.competition.name,
        prediction=prediction_dict,
        user_message=body.message,
        history=body.history,
    )
    if not reply:
        raise HTTPException(503, "LLM indisponible")
    return ChatResponse(reply=reply)


@router.get("/context/{event_id}")
def get_match_context(event_id: int, db: Session = Depends(get_db)):
    """Analyse contextuelle LLM d'un match (blessures, forme, enjeux)."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(404, "Événement non trouvé")

    pred = db.query(Prediction).filter(Prediction.event_id == event_id).first()
    if not pred:
        raise HTTPException(404, "Prédiction non calculée")

    context = enrich_match_context(
        home_team=event.home_team.name,
        away_team=event.away_team.name,
        competition=event.competition.name,
        prob_home=pred.prob_home,
        prob_draw=pred.prob_draw,
        prob_away=pred.prob_away,
        markets=pred.markets or {},
    )
    return context
