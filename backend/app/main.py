from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from app.database import engine, Base
from app.api.routes import events, parlays, bankroll, admin

# Celery/Redis optionnel — ne bloque pas le démarrage
try:
    import celery  # noqa
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Créer les tables au démarrage
    Base.metadata.create_all(bind=engine)
    logger.info("Base de données initialisée")
    yield


app = FastAPI(
    title="SportsBet Analyzer",
    description="Outil d'analyse probabiliste pour paris sportifs",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(events.router, prefix="/api/v1")
app.include_router(parlays.router, prefix="/api/v1")
app.include_router(bankroll.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")


@app.get("/")
def root():
    return {
        "name": "SportsBet Analyzer API",
        "version": "1.0.0",
        "docs": "/docs",
        "disclaimer": "Outil d'analyse probabiliste. Ne garantit aucun gain. Pariez responsablement.",
    }


@app.get("/health")
def health():
    return {"status": "ok"}
