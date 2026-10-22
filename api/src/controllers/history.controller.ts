import type { Request, Response } from 'express';
import { getPgPool } from '../managers/pgManager.js';
import { commandError } from './engine-response.js';
import { decodeCursor, encodeCursor, queryInteger, queryMarket } from './history-query.js';

export async function getOrderHistory(req: Request, res: Response) {
    try {
        const market = queryMarket(req.query.market);
        const limit = queryInteger(req.query.limit, 50, 1, 100), cursor = decodeCursor(req.query.cursor);
        const { rows } = await getPgPool().query(`SELECT order_id AS "orderId", user_id AS "userId", market, side,
            order_type AS "orderType", price, quantity, executed_qty AS "executedQty", status,
            extract(epoch FROM created_at)*1000 AS "createdAt", extract(epoch FROM updated_at)*1000 AS "updatedAt"
            FROM orders WHERE user_id=$1 AND market=$2
            AND ($3::timestamptz IS NULL OR (updated_at,order_id)<($3::timestamptz,$4::text))
            ORDER BY updated_at DESC,order_id DESC LIMIT $5`,
            [res.locals.userId, market, cursor ? new Date(cursor.time) : null, cursor?.id ?? '', limit + 1]);
        const result = rows.slice(0, limit).map(r => ({ ...r, createdAt: Number(r.createdAt), updatedAt: Number(r.updatedAt) }));
        const last = result.at(-1);
        return res.json({ success: true, payload: { rows: result,
            nextCursor: rows.length > limit && last ? encodeCursor(last.updatedAt, last.orderId) : null } });
    } catch (error) { return commandError(res, error); }
}
export async function getAccountTrades(req: Request, res: Response) {
    try {
        const market = queryMarket(req.query.market);
        const limit = queryInteger(req.query.limit, 50, 1, 100), cursor = decodeCursor(req.query.cursor);
        const { rows } = await getPgPool().query(`SELECT id, market, price, quantity, quote_qty AS "quoteQuantity",
            is_buyer_maker AS "isBuyerMaker", extract(epoch FROM timestamp)*1000 AS timestamp,
            CASE WHEN buyer_id=$1 AND seller_id=$1 THEN 'self' WHEN buyer_id=$1 THEN 'buy' ELSE 'sell' END AS side
            FROM trades WHERE (buyer_id=$1 OR seller_id=$1) AND market=$2
            AND ($3::timestamptz IS NULL OR (timestamp,id)<($3::timestamptz,$4::text))
            ORDER BY timestamp DESC,id DESC LIMIT $5`,
            [res.locals.userId, market, cursor ? new Date(cursor.time) : null, cursor?.id ?? '', limit + 1]);
        const result = rows.slice(0, limit).map(r => ({ ...r, timestamp: Number(r.timestamp) })), last = result.at(-1);
        return res.json({ success: true, payload: { rows: result,
            nextCursor: rows.length > limit && last ? encodeCursor(last.timestamp, last.id) : null } });
    } catch (error) { return commandError(res, error); }
}
