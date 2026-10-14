import fs from 'node:fs';
import dotenv from 'dotenv';
dotenv.config();
import { createClient } from 'redis';
import { Engine } from './trade/engine.js';
import { RedisManager } from './redisManager.js';

async function main() {
    await RedisManager.connect();

    const restore = process.env.WITH_SNAPSHOT;
    if (restore && restore !== '1') throw new Error('WITH_SNAPSHOT must be empty or 1');
    const engine = new Engine({ sink: RedisManager.getInstance(),
        ...(restore === '1' ? { snapshot: JSON.parse(fs.readFileSync('./snapshot.json', 'utf8')) } : {}) });
    const saveSnapshot = () => fs.writeFileSync('./snapshot.json', JSON.stringify(engine.getSnapshot()));
    const snapshotTimer = setInterval(saveSnapshot, 3000);

    const redisClient = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
    await redisClient.connect();
    console.log("Engine is connected to Redis!");

    // --- shutdown ---
    // Save the orderbook snapshot before exiting so state is not lost on
    // SIGTERM (Docker stop) or SIGINT (Ctrl+C). The engine already snapshots
    // every 3 seconds but this catches the final few seconds.
    let shuttingDown = false;

    function shutdown(signal: string) {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\n[engine] Received ${signal} — saving snapshot and exiting…`);
        clearInterval(snapshotTimer);
        saveSnapshot();
        redisClient.disconnect().catch(() => {});
        process.exit(0);
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

    // ── Main consume loop ─────────────────────────────────────────────────────
    while (!shuttingDown) {
        try {
            // 1-second timeout so Ctrl+C responds within 1 second
            const response = await redisClient.brPop("message", 1);

            if (response && response.element) {
                const message = JSON.parse(response.element);
                engine.process(message);
            }
        } catch (err) {
            if (shuttingDown) break;
            console.error("Error processing message:", err);
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
}

main().catch(error => { console.error('Engine startup failed:', error); process.exit(1); });
