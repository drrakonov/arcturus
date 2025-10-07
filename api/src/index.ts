import dotenv from 'dotenv'
dotenv.config();
import express from 'express'
import cors from 'cors'
import orderRouter from './routes/order.routes.js';
import depthRouter from './routes/depth.routes.js';
import tradesRouter from './routes/trades.routes.js';
import klinesRouter from './routes/klines.routes.js';

const app = express();
app.use(cors({
    origin: process.env.CORS_OROGIN
}));
app.use(express.json());

app.use("/api/vi/order", orderRouter);
app.use("/api/vi/depth", depthRouter);
app.use("/api/vi/trades", tradesRouter);
app.use("/api/vi/klines", klinesRouter);
app.use("/api/vi/tickers", )




const PORT = process.env.PORT || 3001
app.get('/', (req, res) => {
    return res.send("API Server us running...🚀")
})


app.listen(PORT)