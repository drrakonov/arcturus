import type { Request, Response } from 'express';
import { TradingError } from '@arcturus/contracts';
import type { PoolClient } from 'pg';
import { getPgPool } from '../managers/pgManager.js';
import { commandError } from './engine-response.js';
import { decodeCursor, encodeCursor, queryInteger } from './history-query.js';

export async function getExecutions(req: Request, res: Response) {
    let client: PoolClient | undefined;
    try {
        const id = req.params.orderId;
        if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new TradingError('INVALID_REQUEST', 'Invalid order ID');
        const limit = queryInteger(req.query.limit, 50, 1, 100), cursor = decodeCursor(req.query.cursor);
        client = await getPgPool().connect();
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const { rows: orders } = await client.query(`SELECT order_id AS "orderId", user_id AS "userId", market, side,
            order_type AS "orderType", price, quantity, executed_qty AS "executedQty", status,
            extract(epoch FROM created_at)*1000 AS "createdAt", extract(epoch FROM updated_at)*1000 AS "updatedAt"
            FROM orders WHERE order_id=$1 AND user_id=$2`, [id, res.locals.userId]);
        if (!orders.length) {
            await client.query('COMMIT');
            return res.status(404).json({ success: false, message: 'Order not found or not persisted yet' });
        }
        const order = { ...orders[0], createdAt: Number(orders[0].createdAt), updatedAt: Number(orders[0].updatedAt) };
        const { rows } = await client.query(`SELECT id,price,quantity,maker_order_id AS "makerOrderId",taker_order_id AS "takerOrderId",
            extract(epoch FROM timestamp)*1000 AS timestamp, CASE WHEN maker_order_id=$1 THEN 'maker' ELSE 'taker' END AS role
            FROM trades WHERE (maker_order_id=$1 OR taker_order_id=$1)
            AND ($2::timestamptz IS NULL OR (timestamp,id)<($2::timestamptz,$3::text))
            ORDER BY timestamp DESC,id DESC LIMIT $4`, [id,cursor ? new Date(cursor.time) : null,cursor?.id ?? '',limit+1]);
        const { rows: summary } = await client.query(`SELECT count(*)::integer AS "fillCount",coalesce(sum(quantity),0)::text AS "executedQuantity",
            coalesce(sum(quote_qty),0)::text AS "quoteQuantity", (sum(quote_qty)/nullif(sum(quantity),0))::text AS "averagePrice",
            coalesce(sum(CASE WHEN $2='buy' THEN ($3::numeric-price)*quantity ELSE (price-$3::numeric)*quantity END),0)::text AS "priceImprovement"
            FROM trades WHERE maker_order_id=$1 OR taker_order_id=$1`, [id,order.side,order.price]);
        const fills = rows.slice(0,limit).map(r=>({...r,timestamp:Number(r.timestamp)})), last=fills.at(-1);
        await client.query('COMMIT');
        return res.json({success:true,payload:{order,summary:summary[0],fills,nextCursor:rows.length>limit && last ? encodeCursor(last.timestamp,last.id):null}});
    } catch (error) { await client?.query('ROLLBACK').catch(()=>{}); return commandError(res,error); }
    finally { client?.release(); }
}
