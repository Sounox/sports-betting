"""
Celery est optionnel. Si Redis n'est pas disponible, les tâches
sont appelées directement comme des fonctions Python normales.
"""
try:
    from celery import Celery
    from celery.schedules import crontab
    from app.config import get_settings

    settings = get_settings()

    celery_app = Celery(
        "sportsbet",
        broker=settings.redis_url,
        backend=settings.redis_url,
        include=["app.workers.tasks"],
    )
    celery_app.conf.update(
        task_serializer="json",
        accept_content=["json"],
        result_serializer="json",
        timezone="Europe/Paris",
        enable_utc=True,
    )
    CELERY_AVAILABLE = True

except Exception:
    # Pas de Celery/Redis — mode synchrone
    CELERY_AVAILABLE = False

    class _FakeCeleryApp:
        def task(self, *args, **kwargs):
            def decorator(fn):
                fn.delay = fn  # .delay() appelle la fonction directement
                fn.apply_async = lambda a=None, kw=None, **_: fn(*(a or []), **(kw or {}))
                return fn
            return decorator

    celery_app = _FakeCeleryApp()
