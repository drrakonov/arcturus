import { createClient, type RedisClientType } from "redis"
import type { WsMessage } from "./types/toWs.js"
import type { MessageToApi } from "./types/toApi.js"
import type { DbMessage } from "@arcturus/contracts";

export class RedisManager {
    private client: RedisClientType;
    private static instance: RedisManager;

    private constructor() {
        this.client = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
    }

    // Call this ONCE at startup with await before the engine loop begins.
    // This guarantees the Redis connection is fully established before
    // any publish/lPush calls are made.
    public static async connect(): Promise<RedisManager> {
        if (!this.instance) {
            this.instance = new RedisManager();
            await this.instance.client.connect();
            console.log("RedisManager: client connected.");
        }
        return this.instance;
    }

    public static getInstance(): RedisManager {
        if (!this.instance) {
            throw new Error(
                "RedisManager is not initialized. Call RedisManager.connect() and await it before use."
            );
        }
        return this.instance;
    }

    public pushMessage(message: DbMessage) {
        this.client.lPush("db_processor", JSON.stringify(message))
            .catch((err) => console.error("RedisManager.pushMessage failed:", err));
    }

    public publishMessage(channel: string, message: WsMessage) {
        this.client.publish(channel, JSON.stringify(message))
            .catch((err) => console.error("RedisManager.publishMessage failed:", err));
    }

    public sendToApi(clientId: string, message: MessageToApi) {
        this.client.publish(clientId, JSON.stringify(message))
            .catch((err) => console.error("RedisManager.sendToApi failed:", err));
    }
}