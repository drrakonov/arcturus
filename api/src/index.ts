import dotenv from 'dotenv'
dotenv.config();
import express from 'express'
import cors from 'cors'
import orderRouter from './routes/order.routes.js';
import depthRouter from './routes/depth.routes.js';
import tradesRouter from './routes/trades.routes.js';
import klinesRouter from './routes/klines.routes.js';
import { RedisManager } from './managers/redisManager.js';

const app = express();
app.use(cors({
    origin: process.env.CORS_OROGIN
}));
app.use(express.json());

app.use("/api/v1/order", orderRouter);
app.use("/api/v1/depth", depthRouter);
app.use("/api/v1/trades", tradesRouter);
app.use("/api/v1/klines", klinesRouter);
//app.use("/api/v1/tickers", );



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