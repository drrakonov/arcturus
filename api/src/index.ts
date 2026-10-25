import { getPgPool } from "./managers/pgManager.js";
import dotenv from "dotenv";

dotenv.config();

import express from "express";
import cors from "cors";
import orderRouter from "./routes/order.routes.js";
import depthRouter from "./routes/depth.routes.js";
import tradesRouter from "./routes/trades.routes.js";
import klinesRouter from "./routes/klines.routes.js";
import tickersRouter from "./routes/tickers.routes.js";
import {
    createSession,
    requireSession,
    getAccount,
    getMarket
} from "./controllers/session.controller.js";
import { RedisManager } from "./managers/redisManager.js";

import { getAccountTrades } from "./controllers/history.controller.js";

const app = express();

app.use(
    cors({
        origin: process.env.CORS_ORIGIN || "http://localhost:5173"
    })
);

app.use(express.json({ limit: "16kb" }));

app.get("/healthz", (_req, res) => res.json({ status: "alive", service: "api" }));

app.get("/readyz", async (_req, res) => {
    try {
        const [services] = await Promise.all([
            RedisManager.getInstance().health(),
            getPgPool().query("SELECT 1")
        ]);
        const ready = Object.values(services).every(Boolean);
        return res
            .status(ready ? 200 : 503)
            .json({ status: ready ? "ready" : "degraded", redis: true, postgres: true, services });
    } catch {
        return res.status(503).json({ status: "unavailable" });
    }
});

app.post("/api/v1/session", createSession);

app.get("/api/v1/account/trades", requireSession, getAccountTrades);

app.get("/api/v1/account", requireSession, getAccount);

app.get("/api/v1/market", getMarket);

app.use("/api/v1/order", requireSession, orderRouter);

app.use("/api/v1/depth", depthRouter);

app.use("/api/v1/trades", tradesRouter);

app.use("/api/v1/klines", klinesRouter);

app.use("/api/v1/tickers", tickersRouter);
// Market provisioning is internal; browsers trade the existing demo market.
app.post("/api/v1/markets", (_req, res) =>
    res
        .status(403)
        .json({ success: false, code: "FORBIDDEN", message: "Market creation is internal" })
);

const PORT = Number(process.env.PORT || 3000);

app.get("/", (req, res) => {
    return res.send("API Server is running...🚀");
});

async function main() {
    const redis = await RedisManager.connect();
    let stopping = false;
    const stop = async (code = 0) => {
        if (stopping) return;
        stopping = true;
        const deadline = setTimeout(() => process.exit(1), 5000);
        await new Promise<void>(resolve => server.close(() => resolve()));
        await stopHeartbeat();
        await redis.close();
        await getPgPool().end();
        clearTimeout(deadline);
        process.exit(code);
    };
    const stopHeartbeat = await redis.startRuntime(error => {
        console.error("[api] Runtime unavailable:", error);
        void stop(1);
    });
    const server = app.listen(PORT, process.env.HOST || "0.0.0.0", () => {
        console.log(`API Server listening on port ${PORT}`);
    });
    process.once("SIGTERM", () => void stop());
    process.once("SIGINT", () => void stop());
}

main().catch(error => {
    console.error("[api] Startup failed:", error);
    process.exit(1);
});
