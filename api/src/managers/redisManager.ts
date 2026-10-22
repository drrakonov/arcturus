import { randomBytes, randomUUID } from 'node:crypto';
import { TradingError, type TraceEvent } from '@arcturus/contracts';
import { createClient } from "redis";
import type { MessageToEngine } from "../types/to.js";
import type { MessageFromOrderbook } from "../types/status.js";

type RedisClient = ReturnType<typeof createClient>;

export class RedisManager {
    private client: RedisClient;
    private publisher: RedisClient;
    private pending = 0;
    private static instance: RedisManager;

    private constructor() {
        this.client = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379", disableOfflineQueue: true });
        this.publisher = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379", disableOfflineQueue: true });
        this.client.on('error', error => console.error('Redis subscriber:', error.message));
        this.publisher.on('error', error => console.error('Redis commands:', error.message));
    }

    // Call once at startup with await before the server starts accepting requests.
    // Ensures both Redis connections are fully live before any subscribe/lPush is attempted.
    public static async connect(): Promise<RedisManager> {
        if (!this.instance) {
            this.instance = new RedisManager();
            await this.instance.client.connect();
            await this.instance.publisher.connect();
            console.log("RedisManager: both clients connected.");
        }
        return this.instance;
    }

    public static getInstance(): RedisManager {
        if (!this.instance) {
            throw new Error(
                "RedisManager not initialized. Call RedisManager.connect() and await it before use."
            );
        }
        return this.instance;
    }

    private async sessionCommand<T>(operation: Promise<T>): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new TradingError('SERVICE_UNAVAILABLE', 'Session service timed out')), 5000);
            })]);
        } catch { throw new TradingError('SERVICE_UNAVAILABLE', 'Session service unavailable'); }
        finally { clearTimeout(timer); }
    }
    public async getSession(token: string) {
        if (!/^[a-f0-9]{64}$/.test(token)) return null;
        if (!this.publisher.isReady) throw new TradingError('SERVICE_UNAVAILABLE', 'Session service unavailable');
        const raw = await this.sessionCommand(this.publisher.get(`demo:session:${token}`));
        return raw ? JSON.parse(raw) as { userId: string; expiresAt: number } : null;
    }
    public async createSession() {
        const userId = randomUUID(), token = randomBytes(32).toString('hex');
        const response = await this.sendAndAwait({ type: 'CREATE_ACCOUNT', data: { userId } });
        if (response.type === 'ERROR') throw new TradingError(response.payload.code, response.payload.message);
        const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
        await this.sessionCommand(this.publisher.set(`demo:session:${token}`, JSON.stringify({ userId, expiresAt }), { EX: 8 * 60 * 60 }));
        return { token, userId, expiresAt };
    }
    public trace(userId: string, event: TraceEvent) {
        void this.publisher.multi().lPush(`trace:${userId}`, JSON.stringify(event)).lTrim(`trace:${userId}`,0,99)
            .expire(`trace:${userId}`,28800).publish(`account@${userId}`,JSON.stringify({stream:`account@${userId}`,data:{e:'trace',event}}))
            .exec().catch(error=>console.error('Trace unavailable:',error.message));
    }
    public async telemetry(userId: string) {
        const [events, queued, processing, failed, pauseSeconds, paused] = await this.sessionCommand(Promise.all([
            this.publisher.lRange(`trace:${userId}`,0,99), this.publisher.lLen('db_processor'),
            this.publisher.lLen('db_processor:processing'),this.publisher.lLen('db_processor:failed'),
            this.publisher.ttl('demo:pause'),this.publisher.exists('demo:worker-paused')
        ]));
        return { events: events.map(raw=>JSON.parse(raw) as TraceEvent), queued, processing, failed,
            pauseSeconds: Math.max(0,pauseSeconds), paused:!!paused, toolsEnabled:(process.env.DEMO_CONTROL_TOKEN?.length ?? 0)>=16 };
    }
    public async pause(seconds: number) {
        if (!seconds) { await this.sessionCommand(this.publisher.del('demo:pause')); return; }
        const accepted = await this.sessionCommand(this.publisher.set('demo:pause-cooldown','1',{NX:true,EX:30}));
        if (!accepted) throw new TradingError('LIMIT_EXCEEDED','Wait 30 seconds between persistence-delay demos');
        await this.sessionCommand(this.publisher.set('demo:pause','1',{EX:seconds}));
    }
    public async sendAndAwait(message: MessageToEngine, requestId?: string): Promise<MessageFromOrderbook> {
        if (!this.client.isReady || !this.publisher.isReady)
            throw new TradingError('SERVICE_UNAVAILABLE', 'Trading service unavailable');
        if (this.pending >= 500) throw new TradingError('LIMIT_EXCEEDED', 'Too many pending requests');
        this.pending++;
        const id = randomUUID();
        const actor = ['CREATE_ORDER','MARKET_ORDER','CANCEL_ORDER','RUN_SCENARIO'].includes(message.type) && 'userId' in message.data ? message.data.userId : undefined;
        const trace = (stage: TraceEvent['stage']) => { if (actor) this.trace(actor,{id:randomUUID(),traceId:id,at:Date.now(),stage}); };
        trace('api_received');
        const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 5000);
        const expiresAt = Date.now() + timeoutMs;
        return new Promise((resolve, reject) => {
            let done = false;
            const finish = (error?: Error, result?: MessageFromOrderbook) => {
                if (done) return;
                done = true; clearTimeout(timer); this.pending--;
                void this.client.unsubscribe(id).catch(() => {});
                if (error) reject(error); else { trace('api_replied'); resolve(result!); }
            };
            const timer = setTimeout(() => finish(new TradingError('REQUEST_TIMEOUT',
                'Engine response timed out. Retry with the same request ID.')), timeoutMs);
            void (async () => {
                try {
                    await this.client.subscribe(id, raw => {
                        try { finish(undefined, JSON.parse(raw)); }
                        catch { finish(new TradingError('INTERNAL_ERROR', 'Invalid engine response')); }
                    });
                    if (done) { await this.client.unsubscribe(id); return; }
                    await this.publisher.lPush('message', JSON.stringify({ clientId: id, message,
                        ...(requestId ? { requestId } : {}), expiresAt }));
                    trace('queued');
                } catch { finish(new TradingError('SERVICE_UNAVAILABLE', 'Trading service unavailable')); }
            })();
        });
    }
}
