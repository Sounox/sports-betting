from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from datetime import datetime, timezone, timedelta
from typing import Optional

from app.database import get_db
from app.models import Bankroll, BettingRecord

router = APIRouter(prefix="/bankroll", tags=["bankroll"])


class BankrollCreate(BaseModel):
    initial_amount: float = Field(..., ge=10)
    currency: str = "EUR"
    daily_limit: Optional[float] = None
    weekly_limit: Optional[float] = None
    max_stake_pct: float = Field(0.025, ge=0.001, le=0.10)
    kelly_fraction: float = Field(0.25, ge=0.05, le=1.0)
    stop_loss_pct: float = Field(0.20, ge=0.05, le=0.50)


class BetRecord(BaseModel):
    event_id: int
    market: str
    selection: str
    odds: float = Field(..., ge=1.01)
    stake: float = Field(..., ge=0.5)
    bookmaker: str = ""
    notes: Optional[str] = None


class BetSettle(BaseModel):
    result: str = Field(..., pattern="^(won|lost|void)$")


@router.get("")
def get_bankroll(db: Session = Depends(get_db)):
    bk = db.query(Bankroll).first()
    if not bk:
        return {"message": "Aucune bankroll configurée. Créez-en une d'abord."}
    return _serialize_bankroll(bk, db)


@router.post("")
def create_bankroll(data: BankrollCreate, db: Session = Depends(get_db)):
    existing = db.query(Bankroll).first()
    if existing:
        raise HTTPException(400, "Une bankroll existe déjà. Utilisez PATCH pour la modifier.")

    bk = Bankroll(
        initial_amount=data.initial_amount,
        current_amount=data.initial_amount,
        currency=data.currency,
        daily_limit=data.daily_limit,
        weekly_limit=data.weekly_limit,
        max_stake_pct=data.max_stake_pct,
        kelly_fraction=data.kelly_fraction,
        stop_loss_pct=data.stop_loss_pct,
    )
    db.add(bk)
    db.commit()
    db.refresh(bk)
    return _serialize_bankroll(bk, db)


@router.get("/history")
def get_bet_history(
    limit: int = 50,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(BettingRecord).order_by(BettingRecord.placed_at.desc())
    if status:
        q = q.filter(BettingRecord.status == status)
    bets = q.limit(limit).all()
    return [_serialize_bet(b) for b in bets]


@router.post("/bets")
def record_bet(data: BetRecord, db: Session = Depends(get_db)):
    bk = db.query(Bankroll).first()
    if not bk:
        raise HTTPException(400, "Configurez une bankroll d'abord")

    # Vérification stop-loss
    drawdown = (bk.initial_amount - bk.current_amount) / bk.initial_amount
    if drawdown >= bk.stop_loss_pct:
        raise HTTPException(403, f"Stop-loss atteint ({drawdown:.0%} de perte). Prenez une pause.")

    # Vérification mise max
    max_stake = bk.current_amount * bk.max_stake_pct
    if data.stake > max_stake:
        raise HTTPException(400, f"Mise trop élevée. Maximum recommandé : {max_stake:.2f} {bk.currency}")

    bet = BettingRecord(
        event_id=data.event_id,
        market=data.market,
        selection=data.selection,
        odds=data.odds,
        stake=data.stake,
        potential_return=data.stake * data.odds,
        bookmaker=data.bookmaker,
        notes=data.notes,
    )
    db.add(bet)
    bk.current_amount -= data.stake  # mise immédiatement déduite
    db.commit()
    db.refresh(bet)
    return _serialize_bet(bet)


@router.patch("/bets/{bet_id}/settle")
def settle_bet(bet_id: int, data: BetSettle, db: Session = Depends(get_db)):
    bet = db.query(BettingRecord).filter(BettingRecord.id == bet_id).first()
    if not bet:
        raise HTTPException(404, "Pari non trouvé")
    if bet.status != "pending":
        raise HTTPException(400, "Ce pari est déjà réglé")

    bk = db.query(Bankroll).first()

    bet.status = data.result
    bet.settled_at = datetime.now(timezone.utc)

    if data.result == "won":
        bet.profit_loss = bet.potential_return - bet.stake
        if bk:
            bk.current_amount += bet.potential_return  # récupère mise + gain
    elif data.result == "lost":
        bet.profit_loss = -bet.stake
        # Mise déjà déduite à l'enregistrement
    elif data.result == "void":
        bet.profit_loss = 0
        if bk:
            bk.current_amount += bet.stake  # remboursement

    db.commit()
    return _serialize_bet(bet)


def _serialize_bankroll(bk: Bankroll, db: Session) -> dict:
    bets = db.query(BettingRecord).all()
    settled = [b for b in bets if b.status in ("won", "lost")]
    total_pl = sum(b.profit_loss or 0 for b in settled)
    total_staked = sum(b.stake for b in settled)
    roi = (total_pl / total_staked * 100) if total_staked > 0 else 0

    # Alerte drawdown
    drawdown = (bk.initial_amount - bk.current_amount) / bk.initial_amount
    alerts = []
    if drawdown >= bk.stop_loss_pct:
        alerts.append(f"🛑 STOP-LOSS ATTEINT : -{drawdown:.0%}. Arrêtez de parier.")
    elif drawdown >= bk.stop_loss_pct * 0.75:
        alerts.append(f"⚠️ Attention : drawdown de {drawdown:.0%} proche du stop-loss")

    return {
        "initial_amount": bk.initial_amount,
        "current_amount": round(bk.current_amount, 2),
        "currency": bk.currency,
        "profit_loss": round(total_pl, 2),
        "roi_pct": round(roi, 2),
        "total_bets": len(settled),
        "win_rate": len([b for b in settled if b.status == "won"]) / len(settled) if settled else 0,
        "max_stake_pct": bk.max_stake_pct,
        "max_stake_amount": round(bk.current_amount * bk.max_stake_pct, 2),
        "kelly_fraction": bk.kelly_fraction,
        "stop_loss_pct": bk.stop_loss_pct,
        "drawdown": round(drawdown, 4),
        "alerts": alerts,
        "disclaimer": "Les paris sportifs sont risqués. Ne misez jamais plus que ce que vous pouvez vous permettre de perdre.",
    }


def _serialize_bet(bet: BettingRecord) -> dict:
    return {
        "id": bet.id,
        "event_id": bet.event_id,
        "market": bet.market,
        "selection": bet.selection,
        "odds": bet.odds,
        "stake": bet.stake,
        "potential_return": bet.potential_return,
        "bookmaker": bet.bookmaker,
        "status": bet.status,
        "profit_loss": bet.profit_loss,
        "placed_at": bet.placed_at.isoformat(),
        "settled_at": bet.settled_at.isoformat() if bet.settled_at else None,
    }
