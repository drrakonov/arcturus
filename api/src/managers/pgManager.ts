import pg from "pg";

const { Pool } = pg;

let pool: InstanceType<typeof Pool> | null = null;

/**
 * Returns the singleton pg.Pool for TimescaleDB queries.
 * Created lazily on first call — no connection is opened until a query is made.
 */
export function getPgPool(): InstanceType<typeof Pool> {
    if (!pool) {
        pool = new Pool({
            host:     process.env.POSTGRES_HOST     ?? "localhost",
            port:     Number(process.env.POSTGRES_PORT ?? 5432),
            database: process.env.POSTGRES_DB       ?? "my_database",
            user:     process.env.POSTGRES_USER     ?? "your_user",
            password: process.env.POSTGRES_PASSWORD ?? "your_password",
        });

        pool.on("error", (err) => {
            console.error("[pgManager] Idle client error:", err);
        });
    }
    return pool;
}
