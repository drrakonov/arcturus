import type { Request, Response } from "express";
import { getPgPool } from "../managers/pgManager.js";


export const getTickers = async (req: Request, res: Response) => {
    try {
        const { symbol } = req.query;

        if (!symbol) {
            return res.status(400).json({ success: false, message: "symbol is required" });
        }

        const sql = `
            SELECT
                MAX(price)                                                    AS high,
                MIN(price)                                                    AS low,
                SUM(quantity)                                                 AS volume,
                SUM(quote_qty)                                                AS quote_volume,
                COUNT(*)                                                      AS trade_count,
                (SELECT price FROM trades
                    WHERE market = $1 AND timestamp >= NOW() - INTERVAL '24 hours'
                    ORDER BY timestamp ASC  LIMIT 1)                          AS open_price,
                (SELECT price FROM trades
                    WHERE market = $1 AND timestamp >= NOW() - INTERVAL '24 hours'
                    ORDER BY timestamp DESC LIMIT 1)                          AS last_price
            FROM trades
            WHERE market = $1
              AND timestamp >= NOW() - INTERVAL '24 hours';
        `;

        const { rows } = await getPgPool().query(sql, [symbol as string]);
        const row = rows[0];

        // If no trades in last 24h, return zeroed-out ticker
        if (!row || row.last_price === null) {
            return res.status(200).json({
                success: true,
                payload: {
                    symbol,
                    lastPrice:          "0",
                    openPrice:          "0",
                    high:               "0",
                    low:                "0",
                    volume:             "0",
                    quoteVolume:        "0",
                    priceChange:        "0",
                    priceChangePercent: "0.00",
                    tradeCount:         0,
                },
            });
        }

        const lastPrice  = Number(row.last_price);
        const openPrice  = Number(row.open_price);
        const priceChange        = lastPrice - openPrice;
        const priceChangePercent = openPrice !== 0
            ? ((priceChange / openPrice) * 100).toFixed(2)
            : "0.00";

        return res.status(200).json({
            success: true,
            payload: {
                symbol,
                lastPrice:          row.last_price,
                openPrice:          row.open_price,
                high:               row.high,
                low:                row.low,
                volume:             row.volume,
                quoteVolume:        row.quote_volume,
                priceChange:        priceChange.toString(),
                priceChangePercent: priceChangePercent,
                tradeCount:         Number(row.trade_count),
            },
        });
    } catch (err) {
        console.error("Failed to get the tickers", err);
        return res.status(500).json({ success: false, message: "Failed to get the tickers" });
    }
};