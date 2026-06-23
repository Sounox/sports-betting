from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "sqlite:///./sportsbet.db"
    redis_url: str = "redis://localhost:6379/0"
    odds_api_key: str = "baa56883db051af74cc48c5512bfc426"
    football_data_api_key: str = "23589c0d13d34aa1bc32e5f2017b7e34"
    secret_key: str = "dev-secret-change-in-prod"
    debug: bool = True

    # Modèle
    dixon_coles_xi: float = 0.0018  # decay temporel (~1 an)
    home_advantage_default: float = 0.25
    min_matches_for_prediction: int = 5
    value_bet_min_edge: float = 0.03  # 3% edge minimum
    value_bet_min_ev: float = 0.0

    # Bankroll
    kelly_fraction: float = 0.25
    max_stake_pct: float = 0.025
    max_parlay_stake_pct: float = 0.01

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
