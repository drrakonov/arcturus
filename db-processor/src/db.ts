import pg from "pg";

export function retentionDays() {
    const value = process.env.TRADE_RETENTION_DAYS ?? "7";
    if (!/^[0-9]+$/.test(value) || +value < 1 || +value > 30)
        throw new Error("TRADE_RETENTION_DAYS must be 1–30");
    return +value;
}

const { Pool } = pg;

let pool: InstanceType<typeof Pool> | null = null;

/**
 * Returns the singleton pg.Pool, creating it on first call.
 * It is basically the pool of connections, Which can be utilize by the
 * Request's when needed.
 */
export function getPool(): InstanceType<typeof Pool> {
    if (!pool) {
        let connectionString = process.env.DATABASE_URL;
        if (connectionString && process.env.POSTGRES_SSL === "true") {
            const url = new URL(connectionString);
            // URL SSL options must not override certificate verification.
            for (const key of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert"])
                url.searchParams.delete(key);
            connectionString = url.toString();
        }
        pool = new Pool({
            max: 4,
            connectionTimeoutMillis: 3000,
            statement_timeout: 10000,
            connectionString,
            ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: true } : undefined,
            host: process.env.POSTGRES_HOST ?? "localhost",
            port: Number(process.env.POSTGRES_PORT ?? 5432),
            database: process.env.POSTGRES_DB ?? "my_database",
            user: process.env.POSTGRES_USER ?? "your_user",
            password: process.env.POSTGRES_PASSWORD ?? "your_password"
        });

        pool.on("error", err => {
            console.error("[db] Idle client error:", err);
        });
    }
    return pool;
}

/**
 * Closes the pool — call on graceful shutdown.
 */
export async function closePool(): Promise<void> {
    if (pool) {
        await pool.end();
        pool = null;
        console.log("[db] Pool closed.");
    }
}

export async function runMigrations(): Promise<void> {
    const days = retentionDays();
    const mode = process.env.DATABASE_MODE ?? "timescale";
    if (!["postgres", "timescale"].includes(mode))
        throw new Error("DATABASE_MODE must be postgres or timescale");
    const client = await getPool().connect();
    try {
        // Serialize migrations across independent demo instances sharing one database.
        await client.query("SELECT pg_advisory_lock(7283104)");
        // ── Pass 1: plain table DDL inside a transaction ──────────────────────────
        await client.query("BEGIN");

        await client.query(`
            CREATE TABLE IF NOT EXISTS trades (
                id             TEXT        NOT NULL,
                market         TEXT        NOT NULL,
                price          NUMERIC     NOT NULL,
                quantity       NUMERIC     NOT NULL,
                quote_qty      NUMERIC     NOT NULL,
                is_buyer_maker BOOLEAN     NOT NULL,
                timestamp      TIMESTAMPTZ NOT NULL,
                PRIMARY KEY (id, timestamp)
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS orders (
                order_id     TEXT        PRIMARY KEY,
                market       TEXT,
                price        NUMERIC,
                quantity     NUMERIC,
                executed_qty NUMERIC     DEFAULT 0,
                side         TEXT,
                created_at   TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        await client.query(`
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'limit';
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id TEXT;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS history_id TEXT;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT -1;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
            ALTER TABLE trades ADD COLUMN IF NOT EXISTS history_id TEXT;
            ALTER TABLE trades ADD COLUMN IF NOT EXISTS sequence BIGINT;
            ALTER TABLE trades ADD COLUMN IF NOT EXISTS buyer_id TEXT;
            ALTER TABLE trades ADD COLUMN IF NOT EXISTS seller_id TEXT;
            ALTER TABLE trades ADD COLUMN IF NOT EXISTS maker_order_id TEXT;
            ALTER TABLE trades ADD COLUMN IF NOT EXISTS taker_order_id TEXT;
            CREATE TABLE IF NOT EXISTS processed_events(event_id TEXT PRIMARY KEY, occurred_at TIMESTAMPTZ NOT NULL);
            CREATE INDEX IF NOT EXISTS processed_events_age ON processed_events(occurred_at);
            CREATE INDEX IF NOT EXISTS orders_owner_history ON orders(user_id, updated_at DESC, order_id DESC);
            CREATE INDEX IF NOT EXISTS orders_retention ON orders(updated_at);
            CREATE INDEX IF NOT EXISTS trades_history_time ON trades(history_id, market, timestamp DESC, sequence DESC);
            CREATE INDEX IF NOT EXISTS trades_buyer_time ON trades(buyer_id, timestamp DESC, id DESC);
            CREATE INDEX IF NOT EXISTS trades_maker_order ON trades(maker_order_id, timestamp DESC, id DESC);
            CREATE INDEX IF NOT EXISTS trades_taker_order ON trades(taker_order_id, timestamp DESC, id DESC);
            CREATE INDEX IF NOT EXISTS trades_seller_time ON trades(seller_id, timestamp DESC, id DESC);
        `);

        await client.query("COMMIT");

        if (mode === "postgres") {
            console.log(`[db] PostgreSQL migrations complete. Retention: ${days}d.`);
            return;
        }

        // ── Pass 2: TimescaleDB-specific DDL — must NOT be inside a transaction ──
        //    Each statement is auto-committed by the server.

        // Convert trades to a hypertable (no-op if already one)
        await client.query(`
            SELECT create_hypertable(
                'trades', 'timestamp',
                if_not_exists => TRUE,
                migrate_data  => TRUE
            );
        `);

        // Continuous aggregate for 1-minute OHLCV klines
        await client.query(`
            CREATE MATERIALIZED VIEW IF NOT EXISTS klines_1m
            WITH (timescaledb.continuous) AS
            SELECT
                time_bucket('1 minute', timestamp) AS bucket,
                market,
                FIRST(price, timestamp)            AS open,
                MAX(price)                         AS high,
                MIN(price)                         AS low,
                LAST(price, timestamp)             AS close,
                SUM(quantity)                      AS volume
            FROM trades
            GROUP BY bucket, market
            WITH NO DATA;
        `);

        // Cover delayed/replayed fills within the retained window, including recent bars.
        await client.query(
            "SELECT remove_continuous_aggregate_policy('klines_1m', if_exists => TRUE)"
        );
        await client.query(
            `SELECT add_continuous_aggregate_policy('klines_1m',
            start_offset => $1::interval, end_offset => INTERVAL '1 minute',
            schedule_interval => INTERVAL '1 minute')`,
            [`${days} days`]
        );

        // Compression is a storage policy, not a measured savings claim.
        await client.query(`
            ALTER TABLE trades SET (
                timescaledb.compress,
                timescaledb.compress_orderby    = 'timestamp DESC',
                timescaledb.compress_segmentby  = 'market'
            );
        `);

        await client.query(`
            SELECT add_compression_policy(
                'trades',
                INTERVAL '1 hour',
                if_not_exists => TRUE
            );
        `);

        // Replace policies so changing the validated setting takes effect on restart.
        await client.query("SELECT remove_retention_policy('trades', if_exists => TRUE)");
        await client.query("SELECT add_retention_policy('trades', $1::interval)", [`${days} days`]);
        await client.query("SELECT remove_retention_policy('klines_1m', if_exists => TRUE)");
        await client.query("SELECT add_retention_policy('klines_1m', $1::interval)", [
            `${days} days`
        ]);
        await client.query("SELECT set_chunk_time_interval('trades', INTERVAL '1 day')");
        console.log(`[db] Migrations complete. Retention: ${days}d, Compression: after 1h.`);
    } catch (err) {
        try {
            await client.query("ROLLBACK");
        } catch {
            /* DDL may already be committed. */
        }
        throw err;
    } finally {
        await client.query("SELECT pg_advisory_unlock(7283104)").catch(() => {});
        client.release();
    }
}
