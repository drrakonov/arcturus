import type { Request, Response } from "express";
import { getPgPool } from "../managers/pgManager.js";

export const getKlines = async (req: Request, res: Response) => {
    try {
        const { symbol, interval, startTime, endTime, limit } = req.query;

        if (!symbol) {
            return res.status(400).json({ success: false, message: "symbol is required" });
        }

        // Only 1m is supported right now (klines_1m is the only aggregate)
        if (interval && interval !== "1m") {
            return res.status(400).json({ success: false, message: "Only interval=1m is supported" });
        }

        const rowLimit = Math.min(parseInt((limit as string) ?? "500", 10), 1000);

        const conditions: string[] = ["market = $1"];
        const values: (string | number)[] = [symbol as string];
        let idx = 2;

        if (startTime) {
            conditions.push(`bucket >= to_timestamp($${idx} / 1000.0)`);
            values.push(Number(startTime));
            idx++;
        }
        if (endTime) {
            conditions.push(`bucket <= to_timestamp($${idx} / 1000.0)`);
            values.push(Number(endTime));
            idx++;
        }

        const sql = `
            SELECT
                extract(epoch FROM bucket) * 1000  AS timestamp,
                open,
                high,
                low,
                close,
                volume
            FROM klines_1m
            WHERE ${conditions.join(" AND ")}
            ORDER BY bucket ASC
            LIMIT $${idx}
        `;
        values.push(rowLimit);

        const { rows } = await getPgPool().query(sql, values);

        return res.status(200).json({
            success: true,
            payload: rows.map((r) => ({
                timestamp: Number(r.timestamp),
                open:      r.open,
                high:      r.high,
                low:       r.low,
                close:     r.close,
                volume:    r.volume,
            })),
        });
    } catch (err) {
        console.error("Failed to get the klines", err);
        return res.status(500).json({ success: false, message: "Failed to get the klines" });
    }
};