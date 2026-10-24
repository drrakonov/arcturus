import type { Request, Response } from "express";
import { queryInteger, queryMarket } from "./history-query.js";
import { commandError } from "./engine-response.js";
import { getPgPool } from "../managers/pgManager.js";

export const getTrades = async (req: Request, res: Response) => {
    try {
        const { symbol, limit } = req.query;

        const market = queryMarket(symbol);
        const rowLimit = queryInteger(limit, 50, 1, 100);

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
            ORDER BY timestamp DESC, sequence DESC, id DESC
            LIMIT $2
        `;

        const { rows } = await getPgPool().query(sql, [market, rowLimit]);

        return res.status(200).json({
            success: true,
            payload: rows.map(r => ({
                id: r.id,
                price: r.price,
                quantity: r.quantity,
                quoteQty: r.quoteQty,
                isBuyerMaker: r.isBuyerMaker,
                timestamp: Number(r.timestamp)
            }))
        });
    } catch (err) {
        return commandError(res, err);
    }
};
