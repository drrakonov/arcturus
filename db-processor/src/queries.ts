import { getPool } from "./db.js";
import type { TradeAddedData, OrderUpdateData } from "./types.js";

/**
 * Inserts a single trade row into the trades hypertable.
 * Uses INSERT … ON CONFLICT DO NOTHING so duplicate messages are safe.
 */
export async function insertTrade(data: TradeAddedData): Promise<void> {
    const sql = `
        INSERT INTO trades (id, market, price, quantity, quote_qty, is_buyer_maker, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))
        ON CONFLICT DO NOTHING
    `;
    await getPool().query(sql, [
        data.id,
        data.market,
        data.price,
        data.quantity,
        data.quoteQuantity,
        data.isBuyerMaker,
        data.timestamp,
    ]);
}

/**
 * Upserts an order row.
 *
 * Full update (new order + partial fill info):
 *   Creates the row with all columns if it doesn't exist, or updates executedQty.
 *
 * Partial update (fill progress only — orderId + executedQty):
 *   Only increments executed_qty on the existing row.
 */
export async function upsertOrder(data: OrderUpdateData): Promise<void> {
    if (data.market !== undefined) {
        // Full INSERT … ON CONFLICT UPDATE
        const sql = `
            INSERT INTO orders (order_id, market, price, quantity, executed_qty, side)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (order_id) DO UPDATE
                SET executed_qty = EXCLUDED.executed_qty
        `;
        await getPool().query(sql, [
            data.orderId,
            data.market,
            data.price,
            data.quantity,
            data.executedQty,
            data.side,
        ]);
    } else {
        // Partial update: bump executed_qty on the matched maker order
        const sql = `
            UPDATE orders
               SET executed_qty = executed_qty + $2
             WHERE order_id = $1
        `;
        await getPool().query(sql, [data.orderId, data.executedQty]);
    }
}
