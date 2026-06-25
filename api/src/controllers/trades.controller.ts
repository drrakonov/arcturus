import type { Request, Response } from "express";
import { getPgPool } from "../managers/pgManager.js";


export const getTrades = async (req: Request, res: Response) => {
    try {
        const { symbol, limit } = req.query;

        if (!symbol) {
            return res.status(400).json({ success: false, message: "symbol is required" });
        }

        const rowLimit = Math.min(parseInt((limit as string) ?? "50", 10), 100);

        const sql = `
            SELECT
                id,
                price,
                quantity,
                quote_qty      AS "quoteQty",
                is_buyer_maker AS "isBuyerMaker",
                extract(epoch FROM timestamp) * 1000 AS timestamp
            FROM trades
            WHERE market = $1
            ORDER BY timestamp DESC
            LIMIT $2
        `;

        const { rows } = await getPgPool().query(sql, [symbol as string, rowLimit]);

        return res.status(200).json({
            success: true,
            payload: rows.map((r) => ({
                id:           r.id,
                price:        r.price,
                quantity:     r.quantity,
                quoteQty:     r.quoteQty,
                isBuyerMaker: r.isBuyerMaker,
                timestamp:    Number(r.timestamp),
            })),
        });
    } catch (err) {
        console.error("Failed to get the trades", err);
        return res.status(500).json({ success: false, message: "Failed to get the trades" });
    }
};