from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.orm import Session
import threading
from app.database import get_db, SessionLocal
from app.models import Competition, Event, Prediction, OddsSnapshot
from app.providers.football_data import SUPPORTED_COMPETITIONS
from app.providers.odds_api import odds_api_client

router = APIRouter(prefix="/admin", tags=["admin"])


def _run_in_thread(fn, *args):
    """Lance une fonction dans un thread séparé (fallback sans Celery)."""
    t = threading.Thread(target=fn, args=args, daemon=True)
    t.start()


@router.get("/status")
def system_status(db: Session = Depends(get_db)):
    """Vue d'ensemble de l'état du système."""
    return {
        "events_total": db.query(Event).count(),
        "events_scheduled": db.query(Event).filter(Event.status == "scheduled").count(),
        "predictions_computed": db.query(Prediction).count(),
        "odds_snapshots": db.query(OddsSnapshot).count(),
        "competitions_active": db.query(Competition).filter(Competition.is_active == True).count(),
        "odds_api_quota": odds_api_client.get_quota(),
    }


@router.post("/import/{competition_code}")
def import_competition(
    competition_code: str,
    season: int = None,
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db),
):
    """
    Importe les données d'une compétition.
    Utilise une tâche en arrière-plan pour ne pas bloquer.
    """
    if competition_code not in SUPPORTED_COMPETITIONS:
        return {"error": f"Compétition non supportée. Disponibles: {list(SUPPORTED_COMPETITIONS.keys())}"}

    from app.workers.tasks import fetch_competition_matches
    _run_in_thread(fetch_competition_matches, competition_code, season)
    return {"competition": competition_code, "status": "importing", "message": "Import lancé en arrière-plan"}


@router.post("/predict/all")
def trigger_all_predictions(background_tasks: BackgroundTasks):
    """Lance le calcul des prédictions pour tous les matchs à venir."""
    from app.workers.tasks import run_daily_predictions
    _run_in_thread(run_daily_predictions)
    return {"status": "running", "message": "Calcul des prédictions lancé en arrière-plan"}


@router.post("/odds/refresh")
def refresh_odds(background_tasks: BackgroundTasks):
    """Rafraîchit toutes les cotes."""
    from app.workers.tasks import fetch_all_odds
    _run_in_thread(fetch_all_odds)
    return {"status": "running", "message": "Rafraîchissement des cotes lancé en arrière-plan"}


@router.get("/competitions")
def list_competitions():
    """Liste des compétitions supportées."""
    return [
        {"code": code, **info}
        for code, info in SUPPORTED_COMPETITIONS.items()
    ]
