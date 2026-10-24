import type { Request, Response } from "express";
import { TradingError } from "@arcturus/contracts";
import { getPgPool } from "../managers/pgManager.js";
import { commandError } from "./engine-response.js";
import { queryHistoryId, queryInteger, queryMarket } from "./history-query.js";

export async function getKlines(req: Request, res: Response) {
    try {
        const market = queryMarket(req.query.symbol),
            historyId = queryHistoryId(req.query.historyId);
        const interval = req.query.interval ?? "1m";
        if (interval !== "1m" && interval !== "5s")
            throw new TradingError("INVALID_REQUEST", "Use interval=5s or 1m");
        const limit = queryInteger(req.query.limit, 180, 1, 500),
            now = Date.now();
        const end = queryInteger(req.query.endTime, now, 0, now);
        const window = (interval === "5s" ? 1 : 7) * 86400_000;
        const start = queryInteger(req.query.startTime, Math.max(0, end - window), 0, end);
        if (end - start > window)
            throw new TradingError("INVALID_REQUEST", "Candle query exceeds supported window");
        // Raw fills include the current bucket and delayed arrivals; no refresh-policy lag.
        // Sequence breaks ties when multiple fills share a millisecond.
        const { rows } = await getPgPool().query(
            `SELECT extract(epoch FROM bucket) AS time, open,high,low,close,volume FROM (
            SELECT time_bucket($1::interval,timestamp) AS bucket,
                (array_agg(price ORDER BY timestamp,sequence,id))[1] AS open,
                max(price) AS high,min(price) AS low,
                (array_agg(price ORDER BY timestamp DESC,sequence DESC,id DESC))[1] AS close,sum(quantity) AS volume
            FROM trades WHERE history_id=$2 AND market=$3 AND timestamp>=to_timestamp($4/1000.0)
                AND timestamp<=to_timestamp($5/1000.0)
            GROUP BY bucket ORDER BY bucket DESC LIMIT $6
        ) candles ORDER BY bucket`,
            [interval === "5s" ? "5 seconds" : "1 minute", historyId, market, start, end, limit]
        );
        return res.json({
            success: true,
            payload: rows.map(r => ({
                ...r,
                time: Number(r.time),
                timestamp: Number(r.time) * 1000
            }))
        });
    } catch (error) {
        return commandError(res, error);
    }
}
