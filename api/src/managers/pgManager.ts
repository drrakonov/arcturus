import pg from "pg";

const { Pool } = pg;

let pool: InstanceType<typeof Pool> | null = null;

/**
 * Returns the singleton pg.Pool for TimescaleDB queries.
 * Created lazily on first call — no connection is opened until a query is made.
 */
export function getPgPool(): InstanceType<typeof Pool> {
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
            statement_timeout: 5000,
            connectionString,
            ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: true } : undefined,
            host: process.env.POSTGRES_HOST ?? "localhost",
            port: Number(process.env.POSTGRES_PORT ?? 5432),
            database: process.env.POSTGRES_DB ?? "my_database",
            user: process.env.POSTGRES_USER ?? "your_user",
            password: process.env.POSTGRES_PASSWORD ?? "your_password"
        });

        pool.on("error", err => {
            console.error("[pgManager] Idle client error:", err);
        });
    }
    return pool;
}
