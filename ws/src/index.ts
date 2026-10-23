import { createServer } from 'node:http';
import dotenv from 'dotenv'
dotenv.config();
import { WebSocketServer } from 'ws'
import { UserManager } from './UserManager.js';
import { SubscriptionManager } from './SubscriptionManager.js';

const PORT = Number(process.env.PORT);

async function main() {
    // Connect Redis before the server accepts any connections
    const manager = await SubscriptionManager.connect();
    const stopHeartbeat = await manager.startRuntime(error=>{console.error('[ws] Runtime unavailable:',error);void stop(1);});
    const server = createServer((req,res)=>{
        if(req.url!=='/healthz' && req.url!=='/readyz'){res.writeHead(404);res.end();return;}
        const ready=req.url==='/healthz' || manager.ready;
        res.writeHead(ready?200:503,{'Content-Type':'application/json'});res.end(JSON.stringify({service:'ws',status:ready?'ready':'unavailable'}));
    });

    const wss = new WebSocketServer({ server, maxPayload: 4096 });
    wss.on('connection', (ws) => {

        UserManager.getInstance().addUser(ws);
    });
    server.listen(PORT || 3001);
    let stopping=false;
    async function stop(code=0) {
        if(stopping)return;stopping=true;
        const deadline=setTimeout(()=>process.exit(1),5000);
        UserManager.getInstance().disconnectAll();wss.close();server.close();
        await stopHeartbeat();await manager.close();clearTimeout(deadline);process.exit(code);
    }
    process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
}

main().catch(error=>{console.error('[ws] Startup failed:',error);process.exit(1);});
