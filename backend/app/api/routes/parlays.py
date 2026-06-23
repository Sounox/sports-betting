from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional

from app.database import get_db
from app.parlay_engine.generator import ParlayGenerator, ParlayConfig

router = APIRouter(prefix="/parlays", tags=["parlays"])


class ParlayRequest(BaseModel):
    target_odds: float = Field(..., ge=1.1, le=100, description="Cote totale visée")
    stake: float = Field(..., ge=0.5, le=10000, description="Mise en euros")
    risk_level: str = Field("balanced", pattern="^(prudent|balanced|aggressive)$")
    bankroll: float = Field(1000.0, ge=10)
    max_legs: int = Field(5, ge=2, le=10)
    sport_filter: list[str] = []


@router.post("/generate")
def generate_parlay(request: ParlayRequest, db: Session = Depends(get_db)):
    """Génère un combiné selon les paramètres demandés."""
    config = ParlayConfig(
        target_odds=request.target_odds,
        stake=request.stake,
        risk_level=request.risk_level,
        bankroll=request.bankroll,
        max_legs=request.max_legs,
        sport_filter=request.sport_filter,
    )

    generator = ParlayGenerator()
    result = generator.generate(db, config)

    if not result.success:
        return {
            "success": False,
            "error": result.error,
            "message": "⚠️ Aucun combiné recommandé dans ces conditions. Les paris sportifs comportent des risques importants.",
        }

    return {
        "success": True,
        "parlay": {
            "legs": [
                {
                    "match": f"{leg.home_team} vs {leg.away_team}",
                    "market": leg.market,
                    "selection": leg.selection,
                    "odds": leg.odds,
                    "model_prob": leg.model_prob,
                    "edge": leg.edge,
                    "bookmaker": leg.bookmaker,
                    "ev": leg.ev,
                }
                for leg in result.legs
            ],
            "total_odds": result.total_odds,
            "theoretical_probability": result.theoretical_prob,
            "expected_value": result.ev,
            "stake": result.stake,
            "recommended_stake": result.recommended_stake,
            "potential_return": result.potential_return,
            "risk_level": result.risk_level,
            "warnings": result.warnings,
        },
        "disclaimer": "⚠️ Cette analyse est probabiliste et ne garantit aucun gain. Pariez de manière responsable.",
    }
