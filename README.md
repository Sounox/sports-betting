# SportsBet Analyzer

Outil d'analyse probabiliste pour paris sportifs. **Ne garantit aucun gain.**

## Démarrage rapide

### Prérequis
- Docker Desktop installé et lancé
- Clés API gratuites (optionnelles mais recommandées) :
  - [Football-Data.org](https://www.football-data.org/client/register) — gratuit, 10 req/min
  - [The Odds API](https://the-odds-api.com) — 500 req/mois gratuit

### Lancement

```powershell
cd sports-betting

# Windows
.\start.ps1

# Ou manuellement
cp .env.example .env
# Editer .env avec vos clés
docker-compose up
```

**URLs :**
- Dashboard : http://localhost:3000
- API REST : http://localhost:8000/docs

### Premier démarrage

1. Ouvrez http://localhost:3000/config
2. Cliquez **Importer** sur "FIFA World Cup" (WC)
3. Cliquez **Calculer toutes les prédictions**
4. Consultez http://localhost:3000/value-bets

## Architecture

```
backend/
  app/
    providers/         Connecteurs APIs (Football-Data, Odds API, scrapers)
    sport_models/      Modèles statistiques (Dixon-Coles, Elo)
    value_engine/      Calcul edge, EV, value bets
    parlay_engine/     Générateur de combinés
    bankroll/          Gestion bankroll et Kelly
    api/routes/        Endpoints FastAPI
    workers/           Tâches Celery (jobs périodiques)

frontend/
  src/
    app/               Pages Next.js
    components/        Composants React
    lib/api.ts         Client API
```

## Modèles utilisés

- **Dixon-Coles (1997)** : modèle Poisson bivarié corrigé pour le football
- **Elo adapté** : rating d'équipe avec home advantage et margin-of-victory multiplier
- **Kelly fractionné** : gestion de mise (1/4 Kelly par défaut)

## Sources de données gratuites

| Source | Usage |
|--------|-------|
| Football-Data.org | Matchs, résultats, compétitions |
| The Odds API (free) | Cotes multi-bookmakers |
| Understat.com | xG (scraping) |
| Jeff Sackmann GitHub | Tennis ATP/WTA |

## Avertissement légal

Cet outil est destiné à un usage personnel et éducatif uniquement.
Les paris sportifs comportent des risques financiers importants.
Ne pariez jamais plus que ce que vous pouvez vous permettre de perdre.
Respectez les lois de votre pays concernant les jeux d'argent.
