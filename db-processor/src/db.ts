import pg from "pg";

const { Pool } = pg;

let pool: InstanceType<typeof Pool> | null = null;

/**
 * Returns the singleton pg.Pool, creating it on first call.
 * It is basically the pool of connections, Which can be utilize by the
 * Request's when needed.
 */
export function getPool(): InstanceType<typeof Pool> {
    if (!pool) {
        pool = new Pool({
            host: process.env.POSTGRES_HOST ?? "localhost",
            port: Number(process.env.POSTGRES_PORT ?? 5432),
            database: process.env.POSTGRES_DB ?? "my_database",
            user: process.env.POSTGRES_USER ?? "your_user",
            password: process.env.POSTGRES_PASSWORD ?? "your_password",
        });

        pool.on("error", (err) => {
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
    const client = await getPool().connect();
    try {
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

        await client.query("COMMIT");

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

        // Automatic refresh policy — if_not_exists => TRUE makes this a no-op on re-run
        await client.query(`
            SELECT add_continuous_aggregate_policy(
                'klines_1m',
                start_offset      => INTERVAL '1 hour',
                end_offset        => INTERVAL '1 minute',
                schedule_interval => INTERVAL '1 minute',
                if_not_exists     => TRUE
            );
        `);

        // ── Compression ───────────────────────────────────────────────────────────
        // Compress chunks of the trades hypertable that are older than 1 hour.
        // TimescaleDB columnar compression reduces raw trade data by ~90%.
        // The market maker generates ~27k trades/day uncompressed; compressed
        // that drops to ~2-3k equivalent rows of storage.
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

        // ── Retention policy ──────────────────────────────────────────────────────
        // Drop raw trade chunks older than TRADE_RETENTION_DAYS (default: 7 days).
        // klines_1m is a continuous aggregate — it is NOT affected by this policy.
        // Historical OHLCV data in klines_1m is preserved indefinitely (it's tiny).
        // Only the raw per-trade rows are dropped, which is all the market maker
        // generates in bulk.
        const retentionDays = parseInt(process.env.TRADE_RETENTION_DAYS ?? "7", 10);
        await client.query(`
            SELECT add_retention_policy(
                'trades',
                INTERVAL '${retentionDays} days',
                if_not_exists => TRUE
            );
        `);

        console.log(`[db] Migrations complete. Retention: ${retentionDays}d, Compression: after 1h.`);
    } catch (err) {
        // Attempt rollback only if we're still inside a transaction
        try { await client.query("ROLLBACK"); } catch (_) { /* already committed or not started */ }
        throw err;
    } finally {
        client.release();
    }
}
