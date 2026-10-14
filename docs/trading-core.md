# Trading core: Milestone 1

One synchronous matching engine owns balances and books. Redis lists/PubSub, the
separate database worker, TimescaleDB and the WebSocket service remain in place.
No new dependency or service is required.

## Arithmetic and validation

- Price tick: `0.01`; quantity lot: `0.0001`. Positive decimal **strings** only.
- Price and quantity are each capped at `1,000,000`. Excess fractional precision,
  exponent notation, whitespace, signs, zero, non-finite values and coercion are rejected.
- Internally, prices are integer cents, quantities are integer ten-thousandths, and
  every asset balance uses integer millionths. BigInt multiplication gives exact
  quote cost with six decimal places; no fill-level rounding or tolerance is used.
- Wire order/fill numeric fields remain compatible with existing consumers. They are
  display values only. Trade prices, quantities and costs are serialized decimal strings.
- Market names are uppercase alphanumeric base symbols followed by `_INR`; symbols
  are at most 12 characters and cannot be `INR` itself. IDs are 1–64 alphanumeric or
  hyphen characters. API and engine both validate commands, including Redis callers.

## Matching and accounting

Orders execute at the resting maker's price, best price first, then FIFO at equal
prices. Partial makers retain priority; full makers are removed. Depth is aggregated
from remaining quantities and sorted numerically.

A buy reserves its limit price times full quantity. Each fill removes the corresponding
limit-price reserve, pays the actual maker-price cost and immediately returns the
price improvement. The remaining reserve exactly backs the unfilled order. A sell
reserves base quantity. Cancellation releases only the unfilled reserve in the correct
asset and reports both executed and remaining quantities. Cancelling an absent,
filled or already-cancelled order returns `ORDER_NOT_FOUND` without changing state.

The engine matches and settles against copies of the affected book and balances.
Before committing, it verifies nonnegative balances, exact open-order reserves,
uncrossed books and per-asset conservation. Failure discards the draft and emits no
trade events. This is an in-memory transaction, not a distributed transaction.

Trade maker flags reflect the resting side. Depth events include zero quantities for
fully consumed and cancelled price levels. Events and responses are delivered after
state commit. A transport failure is logged; it cannot roll back an executed trade or
turn it into a business rejection.

Demo bounds: 32 markets, 10,000 resting orders per book, 1,000 accounts and 10,000 funding
transaction IDs per generation. New orders are rejected when a book is full, even if
that order might consume liquidity. Funding is simulated, positive-only and deduplicated;
there is no new public funding or balance endpoint. UUIDs identify new orders.

## Responses and snapshots

API success payloads remain compatible. Rejections use
`{ "success": false, "code": "INSUFFICIENT_FUNDS", "message": "..." }`.

| Error | HTTP status |
| --- | --- |
| Invalid command, decimal or identifier | 400 |
| Unknown market/user or missing open order | 404 |
| Insufficient available funds | 422 |
| Demo capacity or duplicate funding transaction | 409 |
| Unexpected internal failure | 500 |

Market creation waits for the engine acknowledgement instead of claiming success
before validation. Sessions, authentication and ownership checks remain Milestone 2.

Snapshots are now version 2 with integer-unit strings, FIFO array order, trade counters
and funding transaction IDs. Restore validates balances and book invariants. A legacy,
missing or inconsistent snapshot fails startup when restore is requested. Set
`WITH_SNAPSHOT=1` to restore; leave it empty for a fresh isolated demo. Other values
fail startup. The runtime still saves every three seconds and at graceful shutdown.
Do not combine a fresh engine generation with old trading history in a shared demo;
a coordinated reset and recovery guarantees remain later work.

## Verification

```bash
npm test
npm run typecheck
```

`npm test` builds all packages first. The 21 automated tests cover decimal boundaries,
price-time priority on both sides, maker-price execution, partial fills/cancellation,
refunds, exact minimum-size trades, failed-command isolation, self-match accounting,
funding, snapshot round trips, trade/depth events and API rejection mapping. A seeded
500-command test independently recomputes reserves and asset totals after every step.
API controller tests substitute the Redis transport; they do not pretend to be network tests.

For an actual service integration check, first start the user-managed disposable
infrastructure described in `docker/docker-compose.smoke.yml`. Then run:

```bash
SMOKE_DISPOSABLE=1 npm run test:integration
```

This command runs host API/engine/WS/worker processes, requires empty Redis DB 15 on
loopback port 16379 and a local PostgreSQL superuser on port 15432 with the documented
development credentials. It creates its own database, installs TimescaleDB there,
runs the worker's migrations and verifies fractional trades, exact quote cost,
partial cancellation, rejection statuses, public events and both persisted order rows.
It checks the final engine snapshot balances, stops its host processes and removes its
test database/queue keys. No Docker commands are executed. It leaves temporary logs and
an isolated snapshot under the OS temporary directory. Port overrides are
`TEST_POSTGRES_PORT`, `TEST_REDIS_PORT`, `TEST_API_PORT` and `TEST_WS_PORT`.
Run exclusively: Redis Pub/Sub channels are shared across logical database numbers.

## Remaining limitations

- Client-supplied user IDs and cancellation by order ID remain unauthenticated.
- Self-matching remains allowed for the seeded simulator; accounting conserves assets,
  but this is not a production self-trade prevention policy.
- Redis/worker delivery is best effort. Crashes, popped messages and failed publications
  can lose persistence or responses; API waits still lack timeouts. No retry guarantee.
- Maker database updates remain additive. Cancellation lifecycle persistence and replay
  safety belong to Milestone 3; cancelled rows are not yet marked cancelled in SQL.
- Snapshots are non-atomic file writes; no legacy migration, event replay or coordinated
  engine/database restore. Market-data sequences/reconnect reconciliation remain pending.
- Per-command copying and invariant checks favor demonstrable correctness over throughput.
  No new performance or cloud capacity claim is made. Cloud checks remain Milestone 6.
