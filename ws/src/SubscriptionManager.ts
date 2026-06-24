import { createClient, type RedisClientType } from "redis";
import { UserManager } from "./UserManager.js";


export class SubscriptionManager {
    private static instance: SubscriptionManager;
    private subscriptions: Map<string, string[]> = new Map();
    private reverseSubscriptions: Map<string, string[]> = new Map();
    private redisClient: RedisClientType;

    private constructor() {
        this.redisClient = createClient();
        console.log("Connecting to redis...");
    }

    // Call once at startup with await before the WS server accepts connections
    public static async connect(): Promise<SubscriptionManager> {
        if (!this.instance) {
            this.instance = new SubscriptionManager();
            await this.instance.redisClient.connect();
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

    public subscribe(userId: string, subscription: string) {
        console.log("one user is trying to subscribe to redis")
        if (this.subscriptions.get(userId)?.includes(subscription)) {
            return;
        }

        this.subscriptions.set(userId, (this.subscriptions.get(userId) || []).concat(subscription));
        this.reverseSubscriptions
            .set(subscription, (this.reverseSubscriptions
                .get(subscription) || []).concat(userId));

        if (this.reverseSubscriptions
            .get(subscription)?.length === 1) {
            this.redisClient.subscribe(subscription, (msg: string) => {
                this.redisCallbackHandler(msg, subscription);
            });
        }

    }


    private redisCallbackHandler(message: string, channel: string) {
        try {
            const parsedMessage = JSON.parse(message);
            this.reverseSubscriptions.get(channel)?.forEach(s => UserManager.getInstance().getUser(s)?.emit(parsedMessage));
        } catch (err) {
            console.log(message);
            console.log("Error in emitting messages to all channel", err)
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
                this.redisClient.unsubscribe(subscription);
            }
        }
    }

    public userLeft(userId: string) {
        console.log("User left", userId);
        this.subscriptions.get(userId)?.forEach(s => this.unsubscribe(userId, s));
    }

    getSubscriptions(userId: string) {
        return this.subscriptions.get(userId) || [];
    }


}