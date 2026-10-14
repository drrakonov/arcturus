# Arcturus ⚡
> A simulated exchange backend with in-memory matching, Redis messaging and live market data.

**Development status:** Milestone 1 trading-core correctness and local integration are verified.
Frontend, account ownership and public deployment are pending. Current behavior,
verification commands and limitations are described below.

Arcturus is an exchange backend inspired by how platforms like Binance work internally. It implements a **price-time priority matching engine**, **real-time WebSocket market data**, **asynchronous persistence via TimescaleDB**, and a **self-sustaining market maker bot** — all connected through a Redis message bus.

---

## 🏗️ Architecture

![Architecture](./assets/images/architecture.png)

---

## 🧩 Services

| Service | Port | Responsibility |
|---|---|---|
| `api` | 3000 | REST gateway — accepts orders, serves depth/trades/klines |
| `engine` | — | In-memory matching engine, single-threaded, price-time priority |
| `ws` | 3001 | WebSocket server — real-time market data via Redis Pub/Sub |
| `db-processor` | — | Async DB writer — persists trades and orders to TimescaleDB |
| `market-maker` | — | Algorithmic liquidity bot — keeps the order book alive |

---

## ⚙️ Tech Stack

- **Runtime:** Node.js + TypeScript
- **API:** Express.js
- **Message Bus:** Redis (List queue + Pub/Sub)
- **Database:** TimescaleDB (PostgreSQL + time-series hypertables)
- **WebSockets:** `ws` library
- **Containerization:** Docker + Docker Compose
- **Load Testing:** Autocannon


---

## 📊 Performance Benchmarks

**Historical, unverified results:** the original screenshots and figures below are retained
for provenance. Reproducible scripts are not present, and these results have not been
validated against this revision. The trade endpoint now requires `symbol`; it reads
trade rows, not a candle aggregate.

Originally reported with **Autocannon** (`-c 50 connections, -d 10 seconds`) on localhost with the Market Maker bot simultaneously active.

---

### 1. Buy Order Placement — `POST /api/v1/order`

> Full pipeline: API → Redis Queue → In-Memory Engine → Redis Pub/Sub → API response

![Buy Order Benchmark](./assets/images/benchmark-buy-orders.png)

| Metric | Value |
|---|---|
| **Requests/sec (avg)** | **2,177 req/s** |
| **Requests/sec (peak)** | 4,563 req/s |
| **Avg Latency** | 22.46 ms |
| **P99 Latency** | 53 ms |
| **Max Latency** | 65 ms |
| **Total** | **22,000 orders in 10 seconds** |

---

### 2. Sell Order Placement — `POST /api/v1/order`

![Sell Order Benchmark](./assets/images/benchmark-sell-orders.png)

| Metric | Value |
|---|---|
| **Requests/sec (avg)** | **2,267 req/s** |
| **Requests/sec (peak)** | 3,635 req/s |
| **Avg Latency** | 21.53 ms |
| **P99 Latency** | 39 ms |
| **Max Latency** | 193 ms |
| **Total** | **25,000 orders in 11 seconds** |

---

### 3. Trade History — `GET /api/v1/trades?limit=50`

> Queries TimescaleDB hypertable with 10,000+ real trade records

![Trade History Benchmark](./assets/images/benchmark-trade-history.png)

| Metric | Value |
|---|---|
| **Requests/sec (avg)** | **432 req/s** |
| **Avg Latency** | 114.64 ms |
| **P99 Latency** | 370 ms |
| **Throughput** | 2.49 MB/sec |
| **Total** | **4,000 requests, 24.9 MB read in 10s** |

> These figures do not establish current throughput or correctness. New reproducible benchmarks are scheduled for Milestone 7.

---

## 🎬 Live Demos

### Market Maker Bot — Automated Liquidity

The Market Maker runs as an independent microservice, continuously placing and cancelling orders every 2 seconds to keep the book alive. No human users needed.

![Market Maker Demo](./assets/gifs/demo-market-maker.gif)

---

### Real-Time Order Execution

Live order matching and trade execution streamed through the full pipeline.

![Order Execution Demo](./assets/gifs/demo-order-executions.gif)

---

### Sell Orders Under Load

Stress test showing sell order processing with concurrent connections active.

![Sell Orders Demo](./assets/gifs/demo-sell-orders.gif)

---

## 🚀 Getting Started

### Prerequisites
- Node.js 24 recommended (`.nvmrc`); supported baseline: Node 22.12–24.
- npm and Docker with the Compose plugin.
- Local-only demo: default database credentials are for development.

### Install and build (from the repository root)
```bash
npm run bootstrap
npm run build
npm run typecheck
npm test
```
Each service retains its own lockfile. `bootstrap` runs `npm ci` in the contracts
package and every service; `build` builds contracts before their consumers.
No global TypeScript installation is needed.

### Configure
Copy the `.env.example` in each service to `.env` if you need overrides. Service
commands read their own working directory's `.env`. The API, engine and WS server
use `REDIS_URL`; API and worker use the documented `POSTGRES_*` variables.
The engine's `WITH_SNAPSHOT` must be empty for a fresh start or `1` to restore.
Other nonempty values are rejected. Version 2 integer snapshots are required; legacy
floating-point snapshots must not be restored. Use an isolated fresh demo instead.

### Start
```bash
npm run infra:up
npm start
```
Compose starts Redis, TimescaleDB **and exactly one database processor**. The root
start command starts the engine, API and WebSocket server on the host, and stops the
other host processes if one exits. It does not start a duplicate database processor.
Database and Redis host ports bind to loopback only.

In a separate terminal, optionally start the simulator:
```bash
npm run start:market-maker
```
Stop the host services with Ctrl+C; stop infrastructure with `npm run infra:down`.
The latter preserves the database volume. Do not run the simulator during smoke checks.

### Verification
```bash
curl http://localhost:3000/
```
For a **fresh, disposable engine and database only**:
```bash
SMOKE_DISPOSABLE=1 npm run smoke
```
The smoke check places real simulated orders for seeded accounts 1 and 2 and checks
HTTP responses, Redis-mediated matching, persisted trade history and WebSocket events.
That baseline check does not certify balance correctness, candle refresh, durability or cloud readiness.
It intentionally refuses to run without the disposable opt-in. Never run it against
an active/shared demo.

`npm test` builds all packages and runs 21 tests, including exact settlement,
price-time priority, refunds, cancellation, validation, snapshots and a seeded
500-command conservation check. API controller tests substitute the Redis transport.

For a real service integration check, start the disposable infrastructure (Compose
2.24.4 or newer), then run:

```bash
docker compose -p arcturus-m0 \
  -f docker/docker-compose.yml \
  -f docker/docker-compose.smoke.yml \
  up -d --wait redis timescaledb
SMOKE_DISPOSABLE=1 npm run test:integration
```

The runner starts host API/engine/WS/worker processes and checks fractional settlement,
refunds, cancellation, error responses, persistence and WebSocket delivery. It requires
unused Redis DB 15 on localhost:16379 and PostgreSQL on localhost:15432 with the local
development credentials. It creates and removes its own database and queue keys, stops
its host processes and leaves logs/snapshots in a temporary directory. Run it exclusively:
Redis Pub/Sub channels are shared across logical databases. No Docker commands are run
by the test script. Port overrides: `TEST_POSTGRES_PORT`, `TEST_REDIS_PORT`,
`TEST_API_PORT`, `TEST_WS_PORT`.

Stop the disposable containers afterward:

```bash
docker compose -p arcturus-m0 \
  -f docker/docker-compose.yml \
  -f docker/docker-compose.smoke.yml stop
```

The disposable PostgreSQL data uses temporary memory storage and is discarded on stop.

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Health check |
| `POST` | `/api/v1/order` | Place a new order |
| `DELETE` | `/api/v1/order` | Cancel an order |
| `GET` | `/api/v1/order/open` | Get open orders for a user |
| `GET` | `/api/v1/depth` | Get order book depth |
| `GET` | `/api/v1/trades` | Recent trade history |
| `GET` | `/api/v1/klines` | OHLCV candlestick data (1m) |
| `GET` | `/api/v1/tickers` | 24h ticker statistics |
| `POST` | `/api/v1/markets` | Create a market after engine validation and acknowledgement |

Market-data reads require `?symbol=TATA_INR`; open orders require
`?userId=1&market=TATA_INR`. Klines support only `interval=1m`.
There is no market-list GET route, account/balance route, market-order type or frontend yet.

### Trading rules

- Positive decimal strings only: price tick `0.01`, quantity lot `0.0001`; each input
  is capped at `1,000,000`. Invalid precision, zero and non-finite values are rejected.
- BigInt arithmetic uses cents for prices, ten-thousandths for quantities and millionths
  for balances. Matching executes at the maker's price, best price first, then FIFO.
- Buy price improvement is refunded immediately. Cancellation releases only unfilled
  reserves in the correct asset. Draft state is checked for conservation, exact reserves
  and nonnegative balances before being committed.
- Error responses have `success: false`, `code` and `message`: invalid input is HTTP 400,
  unknown market/user/order is 404, insufficient funds is 422, capacity/duplicate funding
  is 409, and unexpected failures are 500.
- Demo limits: 32 markets, 10,000 resting orders per book, 1,000 accounts and 10,000
  funding transaction IDs. Self-matching remains permitted for the simulator.

### Example — Place a Buy Order
```bash
curl -X POST http://localhost:3000/api/v1/order \
  -H "Content-Type: application/json" \
  -d '{"market":"TATA_INR","price":"999","quantity":"1","side":"buy","userId":"1"}'
```

### Example — Subscribe to Live Feed (WebSocket)
```bash
# Connect
wscat -c ws://localhost:3001

# Subscribe (send this message after connecting)
{"method":"SUBSCRIBE","params":["depth@TATA_INR","trade@TATA_INR","ticker@TATA_INR"]}
```

---

## Architecture and current limits

- One engine processes queued commands serially; multiple engine consumers would split state.
- Orders and balances live in memory; snapshots are written every three seconds and on shutdown.
- Snapshot restoration is opt-in, writes are not atomic, and pending events are not replayed.
- Redis lists carry commands and persistence events; Pub/Sub carries replies and live data.
- Database writes are asynchronous and currently lack reliable retry handling.
- Matching, settlement and cancellation use exact integer units and checked in-memory transactions.
- Account ownership, request timeouts and reliable event delivery remain pending.
- Maker database updates are additive; cancellations are not yet recorded as cancelled in SQL.
- There is no coordinated engine/database restore: avoid mixing a fresh engine with old
  history in a shared demo. Legacy snapshots are incompatible with version 2.
- The default market is TATA_INR with seeded simulated users 1, 2 and 5.

The approved roadmap preserves this architecture and adds correctness, a trading frontend,
execution inspection, controlled scenarios and reproducible benchmarks incrementally.
Deployment targets are AWS EC2 Free Tier or Render Free Tier, subject to eligibility
and measured resource fit. Cloud provisioning, public HTTPS/WebSocket verification and
full-stack resource measurements are deferred to Milestone 6; zero-cost deployment has
not been verified. No real funds or cryptocurrency custody is involved.
