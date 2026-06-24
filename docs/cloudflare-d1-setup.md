# Cloudflare D1 history setup

The app can run without D1. In that case, `/api/v1/admin/history/status` returns `enabled: false` and no data is persisted.

To activate durable history:

1. Create a D1 database:

```bash
npx wrangler d1 create sportsbet-history
```

2. Add the returned binding to `wrangler.jsonc` and `frontend/wrangler.jsonc`:

```json
"d1_databases": [
  {
    "binding": "SPORTSBET_DB",
    "database_name": "sportsbet-history",
    "database_id": "PASTE_DATABASE_ID_HERE"
  }
]
```

3. Apply the migration:

```bash
npx wrangler d1 execute sportsbet-history --file=./migrations/0001_history.sql
```

For an existing database, also apply later migrations in order:

```bash
npx wrangler d1 execute sportsbet-history --remote --file=./migrations/0002_backtesting.sql
npx wrangler d1 execute sportsbet-history --remote --file=./migrations/0003_automation_runs.sql
npx wrangler d1 execute sportsbet-history --remote --file=./migrations/0004_player_projection_snapshots.sql
```

4. Deploy:

```bash
npx wrangler deploy
```

After activation, the Cloudflare cron calls `/api/v1/admin/history/snapshot?hours=168` automatically and the dashboard pages `/historique` and `/performance` start showing stored metrics.
