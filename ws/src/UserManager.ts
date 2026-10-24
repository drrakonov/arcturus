import type WebSocket from "ws";
import { SubscriptionManager } from "./SubscriptionManager.js";
import { User } from "./User.js";

export class UserManager {
    private static instance: UserManager;
    private users: Map<string, User> = new Map();

    private constructor() {}

    public static getInstance() {
        if (!this.instance) {
            this.instance = new UserManager();
        }
        return this.instance;
    }

    public disconnectAll() {
        for (const user of this.users.values()) user.disconnect();
    }

    public addUser(ws: WebSocket) {
        if (this.users.size >= 200) {
            ws.close(1013, "Demo connection capacity reached");
            return;
        }
        const id = this.getRandomId();
        const user = new User(id, ws);
        this.users.set(id, user);
        this.registerOnClose(ws, id);
        //console.log("User is added to the redis", user);
        return user;
    }

    private registerOnClose(ws: WebSocket, userId: string) {
        ws.on("close", () => {
            this.users.delete(userId);
            SubscriptionManager.getInstance().userLeft(userId);
        });
    }

    public getUser(userId: string) {
        return this.users.get(userId);
    }

    private getRandomId() {
        return (
            Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15)
        );
    }
}
