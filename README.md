# Arcturus

A simulated SOL/INR exchange with a React trading terminal, a TypeScript matching
engine, Redis messaging, and PostgreSQL/TimescaleDB history. No real funds or deposits.

## Features

- Limit and price-protected immediate-or-cancel orders; price-time priority matching.
- Exact settlement, partial fills, cancellations, and reserve refunds.
- Private guest accounts with virtual balances, open orders, and saved history.
- Live order book, trades, candlestick/depth charts, and execution inspection.
- Market simulator submitting real orders through the API.
- Snapshot recovery, bounded request retries, health checks, and offline demo reset.

## Local development

Requires Node.js 24, npm, and Docker Compose for Redis and TimescaleDB.

```bash
npm run bootstrap
npm run build
npm run typecheck
```

Copy the service `.env.example` files to `.env` in `api`, `engine`, `ws`,
`db-processor`, and `market-maker`. The examples match the local infrastructure defaults.

```bash
docker compose -f docker/docker-compose.yml up -d --build
npm start
# Separate terminals:
npm run dev:frontend
npm run start:market-maker
```

Open http://localhost:5173. The API uses port 3000 and WebSockets use 3001.
Compose owns the database worker; do not start a second worker or matching engine.

## Built application

The application overlay builds all services and serves the compiled frontend through
Nginx, proxying `/api` and `/ws` on the same origin. The database, Redis, and engine
snapshot use named volumes. Do not reuse an existing PostgreSQL volume with different
credentials; changing environment variables does not change an existing database user.

Copy `docker/.env.example` to `docker/.env`, set a private `POSTGRES_PASSWORD`, and
set `PUBLIC_ORIGIN` to the browser-facing URL. Then:

```bash
docker compose --env-file docker/.env -p arcturus \
  -f docker/docker-compose.yml -f docker/docker-compose.app.yml config --quiet
docker compose --env-file docker/.env -p arcturus \
  -f docker/docker-compose.yml -f docker/docker-compose.app.yml up -d --build --wait
```

The frontend binds to localhost:8080 by default. Public deployment needs an HTTPS
proxy/platform ingress in front of it, with WebSocket upgrades enabled. Only expose
that ingress; keep Redis and PostgreSQL private. Public TLS, cloud sizing, container
builds, and restart behavior must be verified on the chosen deployment target.

API `/healthz` reports liveness; `/readyz` checks database connectivity and recent
service heartbeats. Readiness does not guarantee every asynchronous write succeeded.

## Recovery and limits

- Guest sessions expire after eight hours. Funds and market prices are simulated.
- SQL persistence is asynchronous; recent history can briefly lag live balances.
- Engine snapshots are written atomically every three seconds. `WITH_SNAPSHOT=1`
  requires an existing snapshot; `auto` restores one if present or initializes a first
  run. Corrupt snapshots fail startup. Do not restore stale state against newer SQL.
- Request deduplication lasts ten minutes in memory and does not survive engine restarts.
- Inspect failed persistence events before replaying with `npm --prefix db-processor run replay:failed -- 50`.
- `TRADE_RETENTION_DAYS` supports 1–30 days, default 7. Closed history is pruned;
  open orders remain. Snapshot and Redis/SQL delivery are not one durable transaction.
- For an offline reset, stop all app services and drain queues first. With Redis running,
  set `RESET_DEMO=1`, an explicit `REDIS_URL`, and an absolute `SNAPSHOT_PATH`, then run
  `npm run reset:demo`. It backs up the snapshot, resets guest sessions and engine state,
  and retains SQL history. Never reset a running market.

Resource limits are configured, not cloud capacity guarantees.
