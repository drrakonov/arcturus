import dotenv from 'dotenv'
dotenv.config();
import express from 'express'
import cors from 'cors'
import orderRouter from './routes/order.routes.js';
import depthRouter from './routes/depth.routes.js';
import tradesRouter from './routes/trades.routes.js';
import klinesRouter from './routes/klines.routes.js';
import tickersRouter from './routes/tickers.routes.js';
import { createSession, requireSession, getAccount, getMarket } from './controllers/session.controller.js';
import { RedisManager } from './managers/redisManager.js';

const app = express();
app.use(cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173"
}));
app.use(express.json());

app.post('/api/v1/session', createSession);
app.get('/api/v1/account', requireSession, getAccount);
app.get('/api/v1/market', getMarket);
app.use("/api/v1/order", requireSession, orderRouter);
app.use("/api/v1/depth", depthRouter);
app.use("/api/v1/trades", tradesRouter);
app.use("/api/v1/klines", klinesRouter);
app.use("/api/v1/tickers", tickersRouter);
// Market provisioning is internal; browsers trade the existing demo market.
app.post('/api/v1/markets', (_req, res) => res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'Market creation is internal' }));



const PORT = process.env.PORT || 3000
app.get('/', (req, res) => {
    return res.send("API Server is running...🚀")
})

async function main() {
    await RedisManager.connect();
    app.listen(PORT, () => {
        console.log(`API Server listening on port ${PORT}`);
    });
}

main();