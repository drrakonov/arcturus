import dotenv from 'dotenv';
dotenv.config();
import axios from 'axios';
import { randomUUID } from 'node:crypto';

const BASE_URL   = process.env.API_BASE_URL  ?? "http://localhost:3000";
const MARKET     = process.env.MARKET        ?? "SOL_INR";
const client = axios.create({ baseURL: BASE_URL, timeout: 8000 });
let sessionToken = '';
client.interceptors.request.use(config => {
    if (sessionToken) config.headers.Authorization = `Bearer ${sessionToken}`;
    if (['post', 'delete'].includes(config.method ?? '') && config.url?.includes('/order'))
        config.headers['Idempotency-Key'] = randomUUID();
    return config;
});
const TOTAL_BIDS = parseInt(process.env.TOTAL_BIDS ?? "15", 10);
const TOTAL_ASKS = parseInt(process.env.TOTAL_ASKS ?? "15", 10);
const INTERVAL   = parseInt(process.env.INTERVAL_MS ?? "2000", 10);

// Cancel a bid  if it's more than STALE_SPREAD below the new mid (too far to fill).
// Cancel an ask if it's more than STALE_SPREAD above the new mid (too far to fill).
// Also cancel 5% of orders randomly to keep the book fresh.
const STALE_SPREAD  = parseFloat(process.env.STALE_SPREAD ?? "2");
const RANDOM_CHURN  = parseFloat(process.env.RANDOM_CHURN ?? "0.05");

let consecutiveErrors = 0;
let mid = 1000;
let takeBuy = true;

async function main() {
    try {
        if (!sessionToken) {
            const response = await client.post('/api/v1/session');
            sessionToken = response.data.payload.token;
        }
        // Bounded continuous walk; every displayed move still comes from an engine fill.
        mid = Math.max(980, Math.min(1020, mid + (Math.random() - .5) * 2));

        const res = await client.get(
            `${BASE_URL}/api/v1/order/open?market=${MARKET}`
        );

        const openOrders = res.data.payload;
        if (!Array.isArray(openOrders)) {
            console.error("Expected array of orders, got:", openOrders);
            return;
        }

        const totalBids = openOrders.filter((o: any) => o.side === "buy").length;
        const totalAsks = openOrders.filter((o: any) => o.side === "sell").length;

        const cancelledBids = await cancelStaleBids(openOrders, mid);
        const cancelledAsks = await cancelStaleAsks(openOrders, mid);

        let bidsToAdd = TOTAL_BIDS - totalBids + cancelledBids;
        let asksToAdd = TOTAL_ASKS - totalAsks + cancelledAsks;

        // Place bids and asks in alternating pairs so the book stays balanced
        while (bidsToAdd > 0 || asksToAdd > 0) {
            if (bidsToAdd > 0) {
                await client.post(`${BASE_URL}/api/v1/order`, {
                    market: MARKET,
                  
                    price:    (mid - .2 - Math.random() * 5).toFixed(2),
                    quantity: (0.1 + Math.random() * .9).toFixed(4),
                    side:     "buy"
                });
                bidsToAdd--;
            }

            if (asksToAdd > 0) {
                await client.post(`${BASE_URL}/api/v1/order`, {
                    market: MARKET,
                    // Resting quotes provide actual liquidity on the sell side.
                    price:    (mid + .2 + Math.random() * 5).toFixed(2),
                    quantity: (0.1 + Math.random() * .9).toFixed(4),
                    side:     "sell"
                });
                asksToAdd--;
            }
        }

        // A small alternating taker order exercises the real matching path. This
        // demo account may self-match; no trade or candle is manufactured in the UI.
        await client.post(`${BASE_URL}/api/v1/order`, {
            market: MARKET, side: takeBuy ? 'buy' : 'sell',
            price: (mid + (takeBuy ? 6 : -6)).toFixed(2), quantity: '0.05',
        });
        takeBuy = !takeBuy;
        consecutiveErrors = 0;
        console.log(
            `[${new Date().toLocaleTimeString()}] ✅ mid=${mid.toFixed(1)}` +
            `  bids=${TOTAL_BIDS}  asks=${TOTAL_ASKS}` +
            `  cancelled(bid=${cancelledBids} ask=${cancelledAsks})`
        );
    } catch (err: any) {
        if (err.response?.status === 401) sessionToken = '';
        consecutiveErrors++;
        const backoff = Math.min(consecutiveErrors * 2000, 30000);
        console.error(
            `[${new Date().toLocaleTimeString()}] ⚠️  Error #${consecutiveErrors}: ${err.message}` +
            `  (backing off ${backoff / 1000}s)`
        );
        await new Promise(r => setTimeout(r, backoff));
    }
}

/**
 * Cancel bids that have drifted more than STALE_SPREAD below the new mid.
 * These orders are too far away to ever fill — removing them frees up capacity.
 * Also cancels RANDOM_CHURN% of remaining bids to keep the book churning.
 */
async function cancelStaleBids(openOrders: any[], mid: number) {
    const toCancel = openOrders.filter((o: any) =>
        o.side === "buy" &&
        (Number(o.price) < mid - STALE_SPREAD || Math.random() < RANDOM_CHURN)
    );

    await Promise.all(toCancel.map((o: any) =>
        client.delete(`${BASE_URL}/api/v1/order`, {
            data: { orderId: o.orderId, market: MARKET }
        })
    ));

    return toCancel.length;
}

/**
 * Cancel asks that have drifted more than STALE_SPREAD above the new mid.
 * These are too expensive to ever fill.
 */
async function cancelStaleAsks(openOrders: any[], mid: number) {
    const toCancel = openOrders.filter((o: any) =>
        o.side === "sell" &&
        (Number(o.price) > mid + STALE_SPREAD || Math.random() < RANDOM_CHURN)
    );

    await Promise.all(toCancel.map((o: any) =>
        client.delete(`${BASE_URL}/api/v1/order`, {
            data: { orderId: o.orderId, market: MARKET }
        })
    ));

    return toCancel.length;
}

console.log(
    `🚀 Market Maker started — market=${MARKET}  account=dedicated-demo-session` +
    `  interval=${INTERVAL}ms  staleSpread=${STALE_SPREAD}  churn=${RANDOM_CHURN * 100}%`
);
// Avoid overlapping ticks when the API is slow or reconnecting.
async function run() {
    await main();
    setTimeout(run, INTERVAL);
}
void run();
