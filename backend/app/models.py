from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Date,
    ForeignKey, Text, JSON, UniqueConstraint, Index, SmallInteger
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class Competition(Base):
    __tablename__ = "competitions"

    id = Column(Integer, primary_key=True)
    slug = Column(String(100), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    country = Column(String(100))
    sport = Column(String(50), default="football")
    level = Column(SmallInteger, default=1)
    fd_code = Column(String(20))       # football-data.org code (PL, FL1, WC...)
    odds_api_key = Column(String(100)) # clé pour The Odds API
    is_active = Column(Boolean, default=True)
    external_ids = Column(JSON, default=dict)

    teams = relationship("Team", back_populates="competition", foreign_keys="Team.main_competition_id")
    events = relationship("Event", back_populates="competition")


class Team(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    short_name = Column(String(50))
    country = Column(String(100))
    main_competition_id = Column(Integer, ForeignKey("competitions.id"), nullable=True)
    fd_id = Column(Integer)            # football-data.org id
    aliases = Column(JSON, default=list)
    external_ids = Column(JSON, default=dict)

    competition = relationship("Competition", back_populates="teams", foreign_keys=[main_competition_id])

    __table_args__ = (
        Index("idx_team_fd_id", "fd_id"),
    )


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True)
    competition_id = Column(Integer, ForeignKey("competitions.id"), nullable=False)
    home_team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    away_team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    scheduled_at = Column(DateTime(timezone=True), nullable=False)
    status = Column(String(30), default="scheduled")
    season = Column(String(20))
    matchday = Column(SmallInteger)
    fd_id = Column(Integer, unique=True)
    stage = Column(String(50))  # GROUP_STAGE, ROUND_OF_16, etc.

    competition = relationship("Competition", back_populates="events")
    home_team = relationship("Team", foreign_keys=[home_team_id])
    away_team = relationship("Team", foreign_keys=[away_team_id])
    result = relationship("EventResult", back_populates="event", uselist=False)
    odds = relationship("OddsSnapshot", back_populates="event")
    prediction = relationship("Prediction", back_populates="event", uselist=False)

    __table_args__ = (
        Index("idx_event_scheduled", "scheduled_at"),
        Index("idx_event_status", "status"),
    )


class EventResult(Base):
    __tablename__ = "event_results"

    id = Column(Integer, primary_key=True)
    event_id = Column(Integer, ForeignKey("events.id"), unique=True, nullable=False)
    home_score = Column(SmallInteger)
    away_score = Column(SmallInteger)
    home_ht_score = Column(SmallInteger)
    away_ht_score = Column(SmallInteger)
    winner = Column(String(10))  # home, draw, away
    extra_time = Column(Boolean, default=False)
    penalties = Column(Boolean, default=False)
    stats = Column(JSON, default=dict)  # xg, shots, corners, etc.
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    event = relationship("Event", back_populates="result")


class TeamRating(Base):
    __tablename__ = "team_ratings"

    id = Column(Integer, primary_key=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    competition_id = Column(Integer, ForeignKey("competitions.id"), nullable=False)
    rating_date = Column(Date, nullable=False)
    elo = Column(Float, default=1500.0)
    attack = Column(Float, default=1.0)   # paramètre Dixon-Coles
    defense = Column(Float, default=1.0)  # paramètre Dixon-Coles
    form_last5 = Column(Float, default=0.5)  # 0-1
    matches_played = Column(Integer, default=0)

    __table_args__ = (
        UniqueConstraint("team_id", "competition_id", "rating_date"),
        Index("idx_rating_team_date", "team_id", "rating_date"),
    )


class OddsSnapshot(Base):
    __tablename__ = "odds_snapshots"

    id = Column(Integer, primary_key=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False)
    bookmaker = Column(String(100), nullable=False)
    market = Column(String(100), nullable=False)  # h2h, totals, spreads
    selections = Column(JSON, nullable=False)
    # [{"key": "home", "name": "PSG", "price": 1.85}, ...]
    overround = Column(Float)
    is_closing = Column(Boolean, default=False)
    captured_at = Column(DateTime(timezone=True), server_default=func.now())
    source = Column(String(50), default="odds_api")

    event = relationship("Event", back_populates="odds")

    __table_args__ = (
        Index("idx_odds_event_market", "event_id", "market", "captured_at"),
    )


class Prediction(Base):
    __tablename__ = "predictions"

    id = Column(Integer, primary_key=True)
    event_id = Column(Integer, ForeignKey("events.id"), unique=True, nullable=False)
    model_version = Column(String(50), default="v1.0")
    predicted_at = Column(DateTime(timezone=True), server_default=func.now())
    confidence = Column(String(20))  # low, medium, high
    data_quality = Column(String(20))  # poor, fair, good
    warning_flags = Column(JSON, default=list)
    inputs_snapshot = Column(JSON, default=dict)

    # Probabilités principales
    prob_home = Column(Float)
    prob_draw = Column(Float)
    prob_away = Column(Float)

    # Marchés calculés
    markets = Column(JSON, default=dict)
    # {
    #   "1x2": {"home": 0.55, "draw": 0.25, "away": 0.20},
    #   "over_under": {"over_0_5": 0.92, "over_1_5": 0.75, ...},
    #   "btts": {"yes": 0.48, "no": 0.52},
    #   "scores": [{"score": "1-0", "prob": 0.12}, ...],
    #   "ht": {"home": 0.40, "draw": 0.38, "away": 0.22}
    # }

    value_bets = Column(JSON, default=list)
    # [{market, selection, model_prob, fair_prob, edge, ev, odds, bookmaker, score}]

    event = relationship("Event", back_populates="prediction")


class BettingRecord(Base):
    __tablename__ = "betting_records"

    id = Column(Integer, primary_key=True)
    prediction_id = Column(Integer, ForeignKey("predictions.id"), nullable=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False)
    market = Column(String(100))
    selection = Column(String(100))
    odds = Column(Float, nullable=False)
    stake = Column(Float, nullable=False)
    potential_return = Column(Float)
    bookmaker = Column(String(100))
    bet_type = Column(String(20), default="single")
    status = Column(String(20), default="pending")  # pending, won, lost, void
    profit_loss = Column(Float)
    placed_at = Column(DateTime(timezone=True), server_default=func.now())
    settled_at = Column(DateTime(timezone=True))
    notes = Column(Text)

    __table_args__ = (
        Index("idx_bet_status", "status"),
        Index("idx_bet_placed_at", "placed_at"),
    )


class ParlayBet(Base):
    __tablename__ = "parlay_bets"

    id = Column(Integer, primary_key=True)
    legs = Column(JSON, nullable=False)
    total_odds = Column(Float, nullable=False)
    theoretical_prob = Column(Float)
    ev = Column(Float)
    stake = Column(Float, nullable=False)
    potential_return = Column(Float)
    risk_level = Column(String(20))
    status = Column(String(20), default="pending")
    profit_loss = Column(Float)
    placed_at = Column(DateTime(timezone=True), server_default=func.now())
    settled_at = Column(DateTime(timezone=True))


class Bankroll(Base):
    __tablename__ = "bankroll"

    id = Column(Integer, primary_key=True)
    initial_amount = Column(Float, nullable=False)
    current_amount = Column(Float, nullable=False)
    currency = Column(String(3), default="EUR")
    daily_limit = Column(Float)
    weekly_limit = Column(Float)
    max_stake_pct = Column(Float, default=0.025)
    kelly_fraction = Column(Float, default=0.25)
    stop_loss_pct = Column(Float, default=0.20)
    staking_method = Column(String(20), default="kelly_fractional")
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
