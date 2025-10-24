import dotenv from 'dotenv'
dotenv.config();
import { WebSocketServer } from 'ws'
import { UserManager } from './UserManager.js';


const PORT = Number(process.env.PORT);
const wss = new WebSocketServer({ port: PORT || 3001 });

wss.on('connection', (ws) => {
    console.log("Connection requrest incomming...");
    UserManager.getInstance().addUser(ws);
});
