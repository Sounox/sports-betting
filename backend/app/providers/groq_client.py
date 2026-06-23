"""
Client Groq (Llama 3.3 70B) — analyse contextuelle et chat.
"""
import json
import logging
import urllib.request
import urllib.error
from app.config import get_settings

logger = logging.getLogger(__name__)

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "llama-3.3-70b-versatile"


def _call(messages: list[dict], max_tokens: int = 800, temperature: float = 0.3) -> str:
    settings = get_settings()
    key = settings.groq_api_key
    if not key:
        return ""

    body = json.dumps({
        "model": MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }).encode()

    req = urllib.request.Request(
        GROQ_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
            "User-Agent": "sportsbet-analyzer/1.0",
        },
    )
    try:
        r = urllib.request.urlopen(req, timeout=15)
        data = json.loads(r.read())
        return data["choices"][0]["message"]["content"].strip()
    except urllib.error.HTTPError as e:
        logger.error(f"Groq HTTP {e.code}: {e.read().decode()[:200]}")
        return ""
    except Exception as e:
        logger.error(f"Groq error: {e}")
        return ""


def enrich_match_context(home_team: str, away_team: str, competition: str,
                          prob_home: float, prob_draw: float, prob_away: float,
                          markets: dict) -> dict:
    """
    Demande au LLM d'analyser le contexte du match et d'identifier
    les facteurs non-quantifiés (blessures, forme, enjeux).
    Retourne un dict avec analyse + niveau de confiance ajusté.
    """
    ou = markets.get("over_under", {})
    btts = markets.get("btts", {})
    lam = markets.get("lambda", {})

    prompt = f"""Tu es un analyste sportif expert. Analyse ce match de football pour la compétition "{competition}" :

Match : {home_team} vs {away_team}
Probabilités modèle : {home_team} {prob_home:.0%} | Nul {prob_draw:.0%} | {away_team} {prob_away:.0%}
Buts attendus : {lam.get('home', '?'):.1f} – {lam.get('away', '?'):.1f} (si disponible)
Over 2.5 : {ou.get('over_2_5', 0):.0%} | BTTS : {btts.get('yes', 0):.0%}

Réponds en JSON strict avec ces champs :
{{
  "context_summary": "2-3 phrases sur le contexte actuel (forme, enjeux, rivalité)",
  "key_factors": ["facteur 1", "facteur 2", "facteur 3"],
  "risk_factors": ["risque 1", "risque 2"],
  "confidence_adjustment": 0,
  "best_market": "le marché le plus intéressant selon toi (ex: Over 2.5, BTTS Oui, Victoire X)",
  "reasoning": "1 phrase d'explication du meilleur marché"
}}

confidence_adjustment : entre -20 et +20 (ajustement en points de % sur la confiance du modèle).
Réponds UNIQUEMENT avec le JSON, sans texte autour."""

    response = _call([{"role": "user", "content": prompt}], max_tokens=500)

    try:
        # Extraire le JSON de la réponse
        start = response.find("{")
        end = response.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(response[start:end])
    except Exception as e:
        logger.warning(f"JSON parse error from Groq: {e}")

    return {
        "context_summary": "Analyse contextuelle non disponible.",
        "key_factors": [],
        "risk_factors": [],
        "confidence_adjustment": 0,
        "best_market": None,
        "reasoning": None,
    }


def chat_about_match(home_team: str, away_team: str, competition: str,
                     prediction: dict, user_message: str,
                     history: list[dict] | None = None) -> str:
    """
    Répond à une question de l'utilisateur sur un match spécifique.
    """
    pred_summary = f"""
Match : {home_team} vs {away_team} ({competition})
Probabilités : {home_team} {prediction.get('prob_home', 0):.0%} | Nul {prediction.get('prob_draw', 0):.0%} | {away_team} {prediction.get('prob_away', 0):.0%}
Confiance modèle : {prediction.get('confidence', 'N/A')}
Value bets détectés : {len(prediction.get('value_bets', []))}
"""
    if prediction.get("value_bets"):
        top = prediction["value_bets"][0]
        pred_summary += f"Meilleur value bet : {top.get('label')} @ {top.get('odds')} (edge {top.get('edge', 0):.1%})\n"

    system = f"""Tu es un assistant expert en analyse de paris sportifs. Tu dois :
- Répondre en français
- Être concis (max 4 phrases)
- Ne jamais garantir de gains
- Toujours rappeler que c'est probabiliste
- Être direct et pratique

Données du match :
{pred_summary}"""

    messages = [{"role": "system", "content": system}]
    if history:
        messages.extend(history[-6:])  # max 3 échanges précédents
    messages.append({"role": "user", "content": user_message})

    return _call(messages, max_tokens=300, temperature=0.5)


def general_chat(user_message: str, context: dict, history: list[dict] | None = None) -> str:
    """
    Chat général sur les paris / l'outil.
    """
    system = f"""Tu es un assistant expert en analyse probabiliste de paris sportifs.
Tu réponds en français, de façon concise et pratique (max 5 phrases).
Tu ne garantis jamais de gains et rappelles le caractère probabiliste.

Contexte de l'outil :
- {context.get('events_total', 0)} matchs en base
- {context.get('predictions_computed', 0)} prédictions calculées
- {context.get('odds_snapshots', 0)} cotes bookmakers
- Modèle : Elo FIFA + Dixon-Coles sur {context.get('events_total', 0)} matchs historiques
"""

    messages = [{"role": "system", "content": system}]
    if history:
        messages.extend(history[-6:])
    messages.append({"role": "user", "content": user_message})

    return _call(messages, max_tokens=400, temperature=0.5)
