import dotenv from "dotenv";
dotenv.config();

import { createClient, type RedisClientType } from "redis";
import { runMigrations, closePool } from "./db.js";
import { insertTrade, upsertOrder } from "./queries.js";
import { TRADE_ADDED, ORDER_UPDATE, type DbMessage } from "./types.js";

const QUEUE_KEY = "db_processor";

async function main(): Promise<void> {
    // ── 1. Run schema migrations first ───────────────────────────────────────────
    console.log("[db-processor] Running migrations…");
    await runMigrations();

    // ── 2. Connect to Redis ───────────────────────────────────────────────────────
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    const redis = createClient({ url: redisUrl }) as RedisClientType;

    redis.on("error", (err) => console.error("[redis] Client error:", err));
    await redis.connect();
    console.log(`[db-processor] Connected to Redis at ${redisUrl}`);
    console.log(`[db-processor] Waiting for messages on "${QUEUE_KEY}"…`);

    // ── 3. shutdown ──────────────────────────────────────────────────────
    let shuttingDown = false;

    async function shutdown(signal: string): Promise<void> {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\n[db-processor] Received ${signal}, shutting down…`);
        try {
            // disconnect() immediately drops the TCP connection, which causes
            // the in-flight brPop to throw, allowing the loop to exit cleanly.
            // quit() deadlocks here because brPop holds the connection open.
            await redis.disconnect();
            await closePool();
        } catch (err) {
            console.error("[db-processor] Error during shutdown:", err);
        }
        process.exit(0);
    }

    process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
    process.on("SIGINT",  () => { void shutdown("SIGINT"); });

    // ── 4. Main consume loop ──────────────────────────────────────────────────────
    while (!shuttingDown) {
        let raw: string | null = null;
        try {
            // brPop with a 1-second timeout: wakes up every second so the
            // shuttingDown flag is checked and Ctrl+C responds immediately.
            const result = await redis.brPop(QUEUE_KEY, 1);
            raw = result?.element ?? null;
        } catch (err) {
            // brPop throws when the client is closed during shutdown
            if (shuttingDown) break;
            console.error("[redis] brPop error:", err);
            await sleep(1000);
            continue;
        }

        if (!raw) continue;

        let message: DbMessage;
        try {
            message = JSON.parse(raw) as DbMessage;
        } catch (err) {
            console.error("[db-processor] Failed to parse message:", raw, err);
            continue;
        }

        try {
            switch (message.type) {
                case TRADE_ADDED:
                    await insertTrade(message.data);
                    break;
                case ORDER_UPDATE:
                    await upsertOrder(message.data);
                    break;
                default:
                    // TypeScript exhaustive check
                    console.warn("[db-processor] Unknown message type:", (message as { type: string }).type);
            }
        } catch (err) {
            console.error(`[db-processor] Failed to persist message (type=${message.type}):`, err);
            // TODO (Phase 3+): push to a dead-letter queue instead of dropping
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
    console.error("[db-processor] Fatal startup error:", err);
    process.exit(1);
});
