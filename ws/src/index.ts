import dotenv from 'dotenv'
dotenv.config();
import { WebSocketServer } from 'ws'
import { UserManager } from './UserManager.js';
import { SubscriptionManager } from './SubscriptionManager.js';

const PORT = Number(process.env.PORT);

async function main() {
    // Connect Redis before the server accepts any connections
    await SubscriptionManager.connect();

    const wss = new WebSocketServer({ port: PORT || 3001 });
    wss.on('connection', (ws) => {
        console.log("Connection request incoming...");
        UserManager.getInstance().addUser(ws);
    });
}

main();
