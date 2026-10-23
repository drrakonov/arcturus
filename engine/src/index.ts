import { saveSnapshot as atomicSnapshot } from './snapshot.js';
import { startHeartbeat } from '@arcturus/contracts';
import fs from 'node:fs';
import dotenv from 'dotenv';
dotenv.config();
import { createClient } from 'redis';
import { Engine } from './trade/engine.js';
import { RedisManager } from './redisManager.js';

async function main() {
    await RedisManager.connect();

    const redisClient = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
    redisClient.on('error',error=>console.error('[engine] Redis unavailable:',error.message));
    await redisClient.connect();
    const stopHeartbeat = await startHeartbeat(redisClient,'engine',error=>{ console.error('[engine] Runtime unavailable:',error); shutdown('runtime failure',1); });
    const snapshotPath = process.env.SNAPSHOT_PATH || './snapshot.json';
    const restore = process.env.WITH_SNAPSHOT;
    if (restore && restore !== '1') throw new Error('WITH_SNAPSHOT must be empty or 1');
    const engine = new Engine({ sink: RedisManager.getInstance(),
        ...(restore === '1' ? { snapshot: JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) } : {}) });
    const saveSnapshot = () => atomicSnapshot(snapshotPath, engine.getSnapshot());
    const snapshotTimer = setInterval(() => {
        try { saveSnapshot(); } catch (error) { console.error('[engine] Snapshot failed:', error); shutdown('snapshot failure',1); }
    }, 3000);

    console.log("Engine is connected to Redis!");

    // --- shutdown ---
    // Save the orderbook snapshot before exiting so state is not lost on
    // SIGTERM (Docker stop) or SIGINT (Ctrl+C). The engine already snapshots
    // every 3 seconds but this catches the final few seconds.
    let shuttingDown = false;
    let finishLoop!: () => void;
    const loopFinished = new Promise<void>(resolve=>{finishLoop=resolve;});

    function shutdown(signal: string, code = 0) {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\n[engine] Received ${signal} — saving snapshot and exiting…`);
        clearInterval(snapshotTimer);
        const deadline = setTimeout(()=>process.exit(1),4000);
        void (async()=>{
            await loopFinished;
            try { saveSnapshot(); } catch(error) { console.error('[engine] Final snapshot failed:',error); code=1; }
            await RedisManager.getInstance().close();
            await stopHeartbeat();
            await redisClient.quit();
            clearTimeout(deadline);process.exit(code);
        })().catch(error=>{console.error('[engine] Shutdown failed:',error);process.exit(1);});
    }

    redisClient.on('reconnecting',()=>shutdown('Redis connection lost',1));
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
    finishLoop();
}

main().catch(error => { console.error('Engine startup failed:', error); process.exit(1); });
