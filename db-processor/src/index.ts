import { randomUUID } from 'node:crypto';
import type { PersistenceBatch, TraceEvent } from '@arcturus/contracts';
import dotenv from 'dotenv';
dotenv.config();
import { createClient } from 'redis';
import { runMigrations, closePool, getPool } from './db.js';
import { persistBatch, pruneHistory } from './persistence.js';
import { acknowledge, claim, quarantine, replayFailed, QUEUE } from './queue.js';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' });
    redis.on('error', error => console.error('[redis]', error.message));
    await redis.connect();
    if (process.argv[2] === '--replay-failed') {
        console.log(`Requeued ${await replayFailed(redis, Number(process.argv[3] ?? 50))} failed events`);
        await redis.quit(); return;
    }
    async function trace(raw: string, stage: TraceEvent['stage']) {
        try {
            const batch = JSON.parse(raw) as PersistenceBatch;
            if (!batch.traceId || !Array.isArray(batch.orders)) return;
            for (const userId of new Set(batch.orders.map(o=>o.userId))) {
                const event: TraceEvent = { id:randomUUID(),traceId:batch.traceId,at:Date.now(),stage,eventId:batch.eventId,
                    orderId:batch.orders.find(o=>o.userId===userId)?.orderId };
                await redis.multi().lPush(`trace:${userId}`,JSON.stringify(event)).lTrim(`trace:${userId}`,0,99)
                    .expire(`trace:${userId}`,28800).publish(`account@${userId}`,JSON.stringify({stream:`account@${userId}`,data:{e:'trace',event}})).exec();
            }
        } catch(error) { console.error('[db-processor] Trace unavailable:',error); }
    }
    async function waitForDemoPause() {
        while (!stopping && await redis.exists('demo:pause')) {
            await redis.set('demo:worker-paused','1',{EX:2}); await sleep(100);
        }
        await redis.del('demo:worker-paused');
    }
    // A dedicated PostgreSQL session enforces the single-worker assumption.
    const lock = await getPool().connect();
    const acquired = await lock.query('SELECT pg_try_advisory_lock(7283103) AS acquired');
    if (!acquired.rows[0].acquired) throw new Error('Another database worker is already running');
    let stopping = false;
    lock.on('error', () => { stopping = true; });
    const stop = () => { stopping = true; };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
    try {
        console.log('[db-processor] Running migrations…');
        await runMigrations();
        console.log(`[db-processor] Waiting for messages on "${QUEUE}"…`);
        let nextPrune = 0;
        while (!stopping) {
            try {
                if (Date.now() >= nextPrune) { await pruneHistory(); nextPrune = Date.now() + 60_000; }
                await waitForDemoPause();
                if (stopping) break;
                const raw = await claim(redis);
                if (raw === null) continue;
                await waitForDemoPause();
                let failure: unknown, persisted = false, attempts = 0;
                for (; attempts < 3 && !stopping; attempts++) {
                    try { await persistBatch(JSON.parse(raw)); persisted = true; break; }
                    catch (error) { failure = error; await sleep(200 * 2 ** attempts); }
                }
                if (persisted) { await acknowledge(redis, raw); await trace(raw,'db_committed'); }
                else if (!stopping) {
                    const message = failure instanceof Error ? failure.message : 'Persistence failed';
                    if (await quarantine(redis, raw, message, attempts)) { console.error('[db-processor] Event retained in failed queue:', message); await trace(raw,'db_failed'); }
                    else { console.error('[db-processor] Failed queue full; consumption paused'); await sleep(1000); }
                }
            } catch (error) { console.error('[db-processor] Retryable worker error:', error); await sleep(1000); }
        }
    } finally {
        // Leave any unacknowledged claim for the next worker, including on SIGTERM.
        await redis.quit();
        await lock.query('SELECT pg_advisory_unlock(7283103)').catch(() => {});
        lock.release(); await closePool();
    }
}
main().catch(error => { console.error('[db-processor] Fatal:', error); process.exit(1); });
