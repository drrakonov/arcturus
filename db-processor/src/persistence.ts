import { parseDecimal, validateMessage } from "@arcturus/contracts";
import type { PersistenceBatch } from "@arcturus/contracts";
import { getPool, retentionDays } from "./db.js";

const identifier = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(v);

const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;

const quantity = (v: unknown, zero = false) => {
    if (zero && v === "0") return 0n;
    return parseDecimal(v, 4);
};

export function validateBatch(value: unknown): PersistenceBatch {
    const b = value as PersistenceBatch;
    if (
        !b ||
        b.type !== "PERSISTENCE_BATCH" ||
        b.version !== 1 ||
        !identifier(b.eventId) ||
        !identifier(b.historyId) ||
        !integer(b.revision) ||
        !integer(b.timestamp) ||
        b.timestamp > Date.now() + 60_000 ||
        !Array.isArray(b.orders) ||
        b.orders.length < 1 ||
        b.orders.length > 10001 ||
        !Array.isArray(b.trades) ||
        b.trades.length > 10000
    )
        throw new Error("Invalid persistence batch (legacy events require manual inspection)");
    const orders = new Set<string>();
    for (const o of b.orders) {
        if (
            !o ||
            !identifier(o.orderId) ||
            orders.has(o.orderId) ||
            !integer(o.createdAt) ||
            o.createdAt > b.timestamp ||
            o.updatedAt !== b.timestamp ||
            (o.orderType !== undefined && !["limit", "market"].includes(o.orderType))
        )
            throw new Error("Invalid order metadata");
        orders.add(o.orderId);
        validateMessage({
            type: "CREATE_ORDER",
            data: {
                market: o.market,
                price: o.price,
                quantity: o.quantity,
                side: o.side,
                userId: o.userId
            }
        });
        const q = quantity(o.quantity),
            filled = quantity(o.executedQty, true);
        if (
            filled > q ||
            !["open", "partially_filled", "filled", "cancelled"].includes(o.status) ||
            (o.status === "filled" && filled !== q) ||
            (o.status === "open" && filled !== 0n) ||
            (o.status === "partially_filled" && (filled === 0n || filled === q)) ||
            (o.status === "cancelled" && filled === q)
        )
            throw new Error("Invalid order lifecycle");
    }
    const trades = new Set<string>();
    for (const t of b.trades) {
        if (
            !t ||
            !identifier(t.id) ||
            trades.has(t.id) ||
            !integer(t.sequence) ||
            t.timestamp !== b.timestamp ||
            !orders.has(t.makerOrderId) ||
            !orders.has(t.takerOrderId) ||
            typeof t.isBuyerMaker !== "boolean"
        )
            throw new Error("Invalid trade metadata");
        trades.add(t.id);
        const maker = b.orders.find(o => o.orderId === t.makerOrderId)!;
        const taker = b.orders.find(o => o.orderId === t.takerOrderId)!;
        if (
            maker.market !== t.market ||
            taker.market !== t.market ||
            maker.side === taker.side ||
            t.buyerId !== (maker.side === "buy" ? maker.userId : taker.userId) ||
            t.sellerId !== (maker.side === "sell" ? maker.userId : taker.userId) ||
            t.isBuyerMaker !== (maker.side === "buy") ||
            parseDecimal(t.price, 2) !== parseDecimal(maker.price, 2) ||
            parseDecimal(t.price, 2) * quantity(t.quantity) !==
                parseDecimal(t.quoteQuantity, 6, 10n ** 30n)
        )
            throw new Error("Invalid trade amounts/owners");
    }
    return b;
}

export async function persistBatch(value: unknown): Promise<void> {
    const batch = validateBatch(value);
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        // Expired events cannot resurrect data after both retention and dedup cleanup.
        const inserted = await client.query(
            `INSERT INTO processed_events(event_id, occurred_at)
            SELECT $1, to_timestamp($2 / 1000.0) WHERE to_timestamp($2 / 1000.0) >= NOW() - $3 * INTERVAL '1 day'
            ON CONFLICT DO NOTHING RETURNING event_id`,
            [batch.eventId, batch.timestamp, retentionDays()]
        );
        if (inserted.rowCount) {
            for (const o of batch.orders)
                await client.query(
                    `INSERT INTO orders
                (order_id, market, price, quantity, executed_qty, side, user_id, history_id, status, revision, created_at, updated_at, order_type)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,to_timestamp($11/1000.0),to_timestamp($12/1000.0),$13)
                ON CONFLICT(order_id) DO UPDATE SET executed_qty=EXCLUDED.executed_qty,
                    status=EXCLUDED.status, revision=EXCLUDED.revision, updated_at=EXCLUDED.updated_at,
                    user_id=EXCLUDED.user_id, history_id=EXCLUDED.history_id
                WHERE orders.revision < EXCLUDED.revision AND
                    (orders.user_id IS NULL OR (orders.user_id=EXCLUDED.user_id AND orders.history_id=EXCLUDED.history_id))`,
                    [
                        o.orderId,
                        o.market,
                        o.price,
                        o.quantity,
                        o.executedQty,
                        o.side,
                        o.userId,
                        batch.historyId,
                        o.status,
                        batch.revision,
                        o.createdAt,
                        o.updatedAt,
                        o.orderType ?? "limit"
                    ]
                );
            for (const t of batch.trades)
                await client.query(
                    `INSERT INTO trades
                (id,market,price,quantity,quote_qty,is_buyer_maker,timestamp,history_id,sequence,buyer_id,seller_id,maker_order_id,taker_order_id)
                VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0),$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
                    [
                        t.id,
                        t.market,
                        t.price,
                        t.quantity,
                        t.quoteQuantity,
                        t.isBuyerMaker,
                        t.timestamp,
                        batch.historyId,
                        t.sequence,
                        t.buyerId,
                        t.sellerId,
                        t.makerOrderId,
                        t.takerOrderId
                    ]
                );
        }
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function pruneHistory() {
    const days = retentionDays();
    await getPool().query(
        `DELETE FROM processed_events WHERE occurred_at < NOW() - $1 * INTERVAL '1 day'`,
        [days]
    );
    await getPool().query(
        `DELETE FROM orders WHERE updated_at < NOW() - $1 * INTERVAL '1 day' AND (status IN ('filled','cancelled') OR user_id IS NULL)`,
        [days]
    );
}
