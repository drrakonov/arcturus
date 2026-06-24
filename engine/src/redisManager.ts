import { createClient, type RedisClientType } from "redis"
import type { ORDER_UPDATE, TRADE_ADDED } from "./types/types.js"
import type { WsMessage } from "./types/toWs.js"
import type { MessageToApi } from "./types/toApi.js"



type DbMessage = {
    type: typeof TRADE_ADDED,
    data: {
        id: string,
        isBuyerMaker: Boolean,
        price: string,
        quantity: string,
        quoteQuantity: string,
        timestamp: number,
        market: string
    } 
} | {
    type: typeof ORDER_UPDATE,
    data: {
        orderId: string,
        executedQty: number,
        market?: string,
        price?: string,
        quantity?: string,
        side?: "buy" | "sell",
    }
}



export class RedisManager {
    private client: RedisClientType;
    private static instance: RedisManager;

    private constructor() {
        this.client = createClient();
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