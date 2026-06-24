import { createClient } from "redis";
import type { MessageToEngine } from "../types/to.js";
import type { MessageFromOrderbook } from "../types/status.js";

type RedisClient = ReturnType<typeof createClient>;

export class RedisManager {
    private client: RedisClient;
    private publisher: RedisClient;
    private static instance: RedisManager;

    private constructor() {
        this.client = createClient();
        this.publisher = createClient();
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

    public getRandomClientId() {
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }

    public async sendAndAwait(message: MessageToEngine) {
        return new Promise<MessageFromOrderbook>(async (resolve) => {
            const id = this.getRandomClientId();
            
            await this.client.subscribe(id, (message, channel) => {
                if (channel !== id) return;
                this.client.unsubscribe(id);
                resolve(JSON.parse(message));
            });

            this.publisher.lPush("message", JSON.stringify({
                clientId: id,
                message
            }))
        })
    }
}