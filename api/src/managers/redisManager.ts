import { randomBytes, randomUUID } from "node:crypto";
import { TradingError, startHeartbeat, HEARTBEAT_PREFIX } from "@arcturus/contracts";
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
        this.client = createClient({
            url: process.env.REDIS_URL || "redis://localhost:6379",
            disableOfflineQueue: true
        });
        this.publisher = createClient({
            url: process.env.REDIS_URL || "redis://localhost:6379",
            disableOfflineQueue: true
        });
        this.client.on("error", error => console.error("Redis subscriber:", error.message));
        this.publisher.on("error", error => console.error("Redis commands:", error.message));
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
            return await Promise.race([
                operation,
                new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(
                        () =>
                            reject(
                                new TradingError("SERVICE_UNAVAILABLE", "Session service timed out")
                            ),
                        5000
                    );
                })
            ]);
        } catch {
            throw new TradingError("SERVICE_UNAVAILABLE", "Session service unavailable");
        } finally {
            clearTimeout(timer);
        }
    }

    public async getSession(token: string) {
        if (!/^[a-f0-9]{64}$/.test(token)) return null;
        if (!this.publisher.isReady)
            throw new TradingError("SERVICE_UNAVAILABLE", "Session service unavailable");
        const raw = await this.sessionCommand(this.publisher.get(`demo:session:${token}`));
        return raw ? (JSON.parse(raw) as { userId: string; expiresAt: number }) : null;
    }

    public async createSession() {
        const userId = randomUUID(),
            token = randomBytes(32).toString("hex");
        const response = await this.sendAndAwait({ type: "CREATE_ACCOUNT", data: { userId } });
        if (response.type === "ERROR")
            throw new TradingError(response.payload.code, response.payload.message);
        const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
        await this.sessionCommand(
            this.publisher.set(`demo:session:${token}`, JSON.stringify({ userId, expiresAt }), {
                EX: 8 * 60 * 60
            })
        );
        return { token, userId, expiresAt };
    }

    public async startRuntime(onFailure: (error: unknown) => void) {
        return startHeartbeat(this.publisher, "api", onFailure);
    }

    public async health() {
        const result = await this.sessionCommand(
            this.publisher.eval(
                `
            local result={}; for _,service in ipairs({'engine','ws','worker'}) do
                local keys=redis.call('KEYS',ARGV[1]..service..':*'); table.insert(result,service); table.insert(result,#keys);
            end; return result`,
                { keys: [], arguments: [HEARTBEAT_PREFIX] }
            )
        );
        const values = result as (string | number)[];
        return Object.fromEntries(
            [0, 2, 4].map(i => [String(values[i]), Number(values[i + 1]) > 0])
        );
    }

    public async close() {
        await Promise.all([this.client.quit(), this.publisher.quit()]);
    }

    public async sendAndAwait(
        message: MessageToEngine,
        requestId?: string
    ): Promise<MessageFromOrderbook> {
        if (!this.client.isReady || !this.publisher.isReady)
            throw new TradingError("SERVICE_UNAVAILABLE", "Trading service unavailable");
        if (this.pending >= 500)
            throw new TradingError("LIMIT_EXCEEDED", "Too many pending requests");
        this.pending++;
        const id = randomUUID();
        const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 5000);
        const expiresAt = Date.now() + timeoutMs;
        return new Promise((resolve, reject) => {
            let done = false;
            const finish = (error?: Error, result?: MessageFromOrderbook) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                this.pending--;
                void this.client.unsubscribe(id).catch(() => {});
                if (error) reject(error);
                else resolve(result!);
            };
            const timer = setTimeout(
                () =>
                    finish(
                        new TradingError(
                            "REQUEST_TIMEOUT",
                            "Engine response timed out. Retry with the same request ID."
                        )
                    ),
                timeoutMs
            );
            void (async () => {
                try {
                    await this.client.subscribe(id, raw => {
                        try {
                            finish(undefined, JSON.parse(raw));
                        } catch {
                            finish(new TradingError("INTERNAL_ERROR", "Invalid engine response"));
                        }
                    });
                    if (done) {
                        await this.client.unsubscribe(id);
                        return;
                    }
                    await this.publisher.lPush(
                        "message",
                        JSON.stringify({
                            clientId: id,
                            message,
                            ...(requestId ? { requestId } : {}),
                            expiresAt
                        })
                    );
                } catch {
                    finish(new TradingError("SERVICE_UNAVAILABLE", "Trading service unavailable"));
                }
            })();
        });
    }
}
