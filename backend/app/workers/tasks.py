import logging
from datetime import date, datetime, timezone, timedelta
from dateutil.parser import parse as parse_dt
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.providers.football_data import football_data_client, SUPPORTED_COMPETITIONS
from app.providers.odds_api import odds_api_client, SPORT_KEYS
from app.models import Competition, Team, Event, EventResult, OddsSnapshot, Prediction
from app.database import engine
from app.models import Base as _Base
from app.sport_models.football_predictor import predict_match

logger = logging.getLogger(__name__)


def get_or_create_competition(db: Session, code: str) -> Competition:
    comp = db.query(Competition).filter(Competition.fd_code == code).first()
    if not comp:
        info = SUPPORTED_COMPETITIONS.get(code, {})
        comp = Competition(
            slug=code.lower(),
            name=info.get("name", code),
            country=info.get("country", ""),
            fd_code=code,
            odds_api_key=SPORT_KEYS.get(code, ""),
            sport="football",
        )
        db.add(comp)
        db.flush()
    return comp


def get_or_create_team(db: Session, fd_id: int, name: str, short_name: str = "") -> Team:
    team = db.query(Team).filter(Team.fd_id == fd_id).first()
    if not team:
        team = Team(name=name, short_name=short_name, fd_id=fd_id)
        db.add(team)
        db.flush()
    elif team.name != name:
        # Mettre à jour les alias si le nom change
        aliases = team.aliases or []
        if team.name not in aliases:
            aliases.append(team.name)
        team.aliases = aliases
        team.name = name
    return team


def fetch_today_matches():
    """Récupère les matchs du jour depuis Football-Data.org."""
    db = SessionLocal()
    try:
        raw_matches = football_data_client.get_today_matches()
        logger.info(f"Récupération {len(raw_matches)} matchs aujourd'hui")

        for raw in raw_matches:
            normalized = football_data_client.normalize_match(raw)
            _upsert_match(db, normalized)

        db.commit()
        return {"fetched": len(raw_matches)}
    except Exception as e:
        db.rollback()
        logger.error(f"Erreur fetch_today_matches: {e}")
        raise
    finally:
        db.close()


def fetch_competition_matches(competition_code: str, season: int = None):
    """Importe tous les matchs d'une compétition."""
    db = SessionLocal()
    try:
        raw_matches = football_data_client.get_matches(
            competition_code, season=season  # None = saison actuelle par défaut
        )
        logger.info(f"Import {len(raw_matches)} matchs pour {competition_code}")

        for raw in raw_matches:
            normalized = football_data_client.normalize_match(raw)
            _upsert_match(db, normalized)

        db.commit()
        return {"competition": competition_code, "imported": len(raw_matches)}
    except Exception as e:
        db.rollback()
        logger.error(f"Erreur fetch_competition_matches {competition_code}: {e}")
        raise
    finally:
        db.close()


def fetch_recent_results():
    """Met à jour les résultats des matchs récemment terminés."""
    db = SessionLocal()
    try:
        # Matchs schedulés qui auraient dû se terminer
        cutoff = datetime.now(timezone.utc) - timedelta(hours=3)
        pending = (
            db.query(Event)
            .filter(Event.status.in_(["scheduled", "SCHEDULED", "TIMED"]))
            .filter(Event.scheduled_at < cutoff)
            .all()
        )

        updated = 0
        for event in pending:
            try:
                raw = football_data_client.get_match(event.fd_id)
                _update_result(db, event, raw)
                updated += 1
            except Exception as e:
                logger.warning(f"Erreur update résultat event {event.id}: {e}")

        db.commit()
        return {"updated": updated}
    except Exception as e:
        db.rollback()
        logger.error(f"Erreur fetch_recent_results: {e}")
        raise
    finally:
        db.close()


def fetch_all_odds():
    """Récupère les cotes depuis The Odds API pour toutes les compétitions actives."""
    db = SessionLocal()
    try:
        active_comps = db.query(Competition).filter(
            Competition.is_active == True,
            Competition.odds_api_key.isnot(None)
        ).all()

        total_fetched = 0
        for comp in active_comps:
            if not comp.odds_api_key:
                continue
            try:
                raw_events = odds_api_client.get_odds(
                    comp.odds_api_key,
                    markets="h2h,totals",
                )
                for raw_event in raw_events:
                    normalized = odds_api_client.normalize_odds(raw_event)
                    _store_odds(db, normalized)
                    total_fetched += 1
            except Exception as e:
                logger.warning(f"Erreur cotes pour {comp.name}: {e}")

        db.commit()
        logger.info(f"Cotes mises à jour: {total_fetched} événements")
        return {"fetched": total_fetched}
    except Exception as e:
        db.rollback()
        logger.error(f"Erreur fetch_all_odds: {e}")
        raise
    finally:
        db.close()


def run_daily_predictions():
    """Calcule les prédictions pour tous les matchs des 48 prochaines heures."""
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        upcoming = (
            db.query(Event)
            .filter(Event.status.in_(["scheduled", "SCHEDULED", "TIMED"]))
            .filter(Event.scheduled_at >= now)
            .filter(Event.scheduled_at <= now + timedelta(hours=48))
            .all()
        )

        computed = 0
        for event in upcoming:
            existing = db.query(Prediction).filter(Prediction.event_id == event.id).first()
            if existing:
                # Recalculer si la prédiction date de plus de 4h
                age_h = (now - existing.predicted_at.replace(tzinfo=timezone.utc)).total_seconds() / 3600
                if age_h < 4:
                    continue
                db.delete(existing)
                db.flush()

            try:
                pred = predict_match(db, event.id)
                if pred:
                    db.add(pred)
                    computed += 1
            except Exception as e:
                logger.warning(f"Erreur prédiction event {event.id}: {e}")

        db.commit()
        logger.info(f"Prédictions calculées: {computed}")
        return {"computed": computed}
    except Exception as e:
        db.rollback()
        logger.error(f"Erreur run_daily_predictions: {e}")
        raise
    finally:
        db.close()


# ── helpers internes ──────────────────────────────────────────────

def _upsert_match(db: Session, normalized: dict):
    # Ignorer les matchs dont les équipes ne sont pas encore connues (TBD)
    if not normalized["home_team"].get("name") or not normalized["away_team"].get("name"):
        return
    comp = get_or_create_competition(db, normalized["competition_code"])
    home = get_or_create_team(db, normalized["home_team"]["fd_id"], normalized["home_team"]["name"], normalized["home_team"].get("short_name", ""))
    away = get_or_create_team(db, normalized["away_team"]["fd_id"], normalized["away_team"]["name"], normalized["away_team"].get("short_name", ""))

    scheduled_raw = normalized["scheduled_at"]
    if isinstance(scheduled_raw, str):
        scheduled_raw = parse_dt(scheduled_raw)

    event = db.query(Event).filter(Event.fd_id == normalized["fd_id"]).first()
    if not event:
        event = Event(
            fd_id=normalized["fd_id"],
            competition_id=comp.id,
            home_team_id=home.id,
            away_team_id=away.id,
            scheduled_at=scheduled_raw,
            status=normalized["status"],
            matchday=normalized.get("matchday"),
            stage=normalized.get("stage"),
            season=normalized.get("season"),
        )
        db.add(event)
        db.flush()
    else:
        event.status = normalized["status"]

    # Résultat si terminé
    score = normalized.get("score", {})
    if normalized["status"] == "FINISHED" and score.get("home") is not None:
        _upsert_result(db, event, score)


def _upsert_result(db: Session, event: Event, score: dict):
    result = db.query(EventResult).filter(EventResult.event_id == event.id).first()
    winner_map = {
        "HOME_TEAM": "home",
        "AWAY_TEAM": "away",
        "DRAW": "draw",
    }
    if not result:
        result = EventResult(
            event_id=event.id,
            home_score=score.get("home"),
            away_score=score.get("away"),
            home_ht_score=score.get("home_ht"),
            away_ht_score=score.get("away_ht"),
            winner=winner_map.get(score.get("winner", ""), None),
        )
        db.add(result)
    else:
        result.home_score = score.get("home")
        result.away_score = score.get("away")
        result.winner = winner_map.get(score.get("winner", ""), None)


def _update_result(db: Session, event: Event, raw: dict):
    normalized = football_data_client.normalize_match(raw)
    event.status = normalized["status"]
    score = normalized.get("score", {})
    if score.get("home") is not None:
        _upsert_result(db, event, score)


def _store_odds(db: Session, normalized: dict):
    """Stocke un snapshot de cotes en faisant correspondre avec les événements existants."""
    # Chercher l'événement par les noms d'équipes et la date
    commence = normalized["commence_time"]
    if isinstance(commence, str):
        from dateutil.parser import parse
        commence = parse(commence)

    # Chercher dans une fenêtre de ±12h
    from datetime import timedelta
    window_start = commence - timedelta(hours=12)
    window_end   = commence + timedelta(hours=12)

    # Correspondance par noms d'équipes (simplifiée)
    home_name = normalized["home_team"]
    away_name = normalized["away_team"]

    event = (
        db.query(Event)
        .join(Event.home_team)
        .join(Event.away_team)
        .filter(Event.scheduled_at.between(window_start, window_end))
        .filter(Team.name.ilike(f"%{home_name[:8]}%"))
        .first()
    )

    if not event:
        logger.debug(f"Événement non trouvé pour {home_name} vs {away_name}")
        return

    for bm_data in normalized["bookmakers"]:
        snap = OddsSnapshot(
            event_id=event.id,
            bookmaker=bm_data["bookmaker"],
            market=bm_data["market"],
            selections=bm_data["selections"],
            overround=bm_data["overround"],
            source="odds_api",
        )
        db.add(snap)
