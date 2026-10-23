import { startHeartbeat } from '@arcturus/contracts';
import { createClient, type RedisClientType } from "redis";
import { UserManager } from "./UserManager.js";


export class SubscriptionManager {
    private static instance: SubscriptionManager;
    private subscriptions: Map<string, string[]> = new Map();
    private reverseSubscriptions: Map<string, string[]> = new Map();
    private commands: RedisClientType;
    private channelReady = new Map<string, Promise<void>>();
    private redisClient: RedisClientType;

    private constructor() {
        this.redisClient = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
        this.commands = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379", disableOfflineQueue: true });
        this.redisClient.on('reconnecting',()=>UserManager.getInstance().disconnectAll());
        this.redisClient.on('error', error => console.error('WS subscription:', error.message));
        this.commands.on('error', error => console.error('WS sessions:', error.message));
    }

    // Call once at startup with await before the WS server accepts connections
    public static async connect(): Promise<SubscriptionManager> {
        if (!this.instance) {
            this.instance = new SubscriptionManager();
            await this.instance.redisClient.connect();
            await this.instance.commands.connect();
            console.log("SubscriptionManager: Redis client connected.");
        }
        return this.instance;
    }

    public static getInstance() {
        if (!this.instance) {
            throw new Error("SubscriptionManager not initialized. Call SubscriptionManager.connect() first.");
        }
        return this.instance;
    }

    public get ready() { return this.redisClient.isReady && this.commands.isReady; }
    public startRuntime(onFailure: (error: unknown)=>void) { return startHeartbeat(this.commands,'ws',onFailure); }
    public async close() { await Promise.all([this.redisClient.quit(),this.commands.quit()]); }
    public async authenticate(token: unknown): Promise<{ userId: string; expiresAt: number } | null> {
        if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
        const raw = await this.commands.get(`demo:session:${token}`);
        if (!raw) return null;
        const session = JSON.parse(raw);
        return session.expiresAt > Date.now() ? session : null;
    }
    public async subscribe(userId: string, subscription: string) {
        if (this.subscriptions.get(userId)?.includes(subscription)) {
            await this.channelReady.get(subscription);
            return;
        }

        this.subscriptions.set(userId, (this.subscriptions.get(userId) || []).concat(subscription));
        this.reverseSubscriptions
            .set(subscription, (this.reverseSubscriptions
                .get(subscription) || []).concat(userId));

        if (this.reverseSubscriptions
            .get(subscription)?.length === 1) {
            const ready = this.redisClient.subscribe(subscription, (msg: string) => {
                this.redisCallbackHandler(msg, subscription);
            });
            this.channelReady.set(subscription, ready);
        }
        await this.channelReady.get(subscription);
    }


    private redisCallbackHandler(message: string, channel: string) {
        try {
            const parsedMessage = JSON.parse(message);
            this.reverseSubscriptions.get(channel)?.forEach(s => UserManager.getInstance().getUser(s)?.emit(parsedMessage));
        } catch (err) {
            console.error("[ws] Invalid stream message", err)
        }
    }

    public unsubscribe(userId: string, subscription: string) {
        const subscriptions = this.subscriptions.get(userId);
        if (subscriptions) {
            this.subscriptions.set(userId, subscriptions.filter(s => s !== subscription));
        }
        const reverseSubscriptions = this.reverseSubscriptions.get(subscription);
        if (reverseSubscriptions) {
            this.reverseSubscriptions.set(subscription, reverseSubscriptions.filter(u => u !== userId));
            if (this.reverseSubscriptions.get(subscription)?.length === 0) {
                this.reverseSubscriptions.delete(subscription);
                this.channelReady.delete(subscription);
                void this.redisClient.unsubscribe(subscription).catch(() => {});
            }
        }
    }

    public userLeft(userId: string) {

        this.subscriptions.get(userId)?.forEach(s => this.unsubscribe(userId, s));
        this.subscriptions.delete(userId);
    }

    getSubscriptions(userId: string) {
        return this.subscriptions.get(userId) || [];
    }


}