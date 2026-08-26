import dotenv from 'dotenv';
dotenv.config();
import axios from 'axios';

const BASE_URL   = process.env.API_BASE_URL  ?? "http://localhost:3000";
const MARKET     = process.env.MARKET        ?? "TATA_INR";
const USER_ID    = process.env.USER_ID       ?? "5";
const TOTAL_BIDS = parseInt(process.env.TOTAL_BIDS ?? "15", 10);
const TOTAL_ASKS = parseInt(process.env.TOTAL_ASKS ?? "15", 10);
const INTERVAL   = parseInt(process.env.INTERVAL_MS ?? "2000", 10);

// Cancel a bid  if it's more than STALE_SPREAD below the new mid (too far to fill).
// Cancel an ask if it's more than STALE_SPREAD above the new mid (too far to fill).
// Also cancel 5% of orders randomly to keep the book fresh.
const STALE_SPREAD  = parseFloat(process.env.STALE_SPREAD ?? "2");
const RANDOM_CHURN  = parseFloat(process.env.RANDOM_CHURN ?? "0.05");

let consecutiveErrors = 0;

async function main() {
    try {
        // Mid-price walks randomly around 1000 ± 10 each tick
        const mid = 1000 + Math.random() * 20 - 10;

        const res = await axios.get(
            `${BASE_URL}/api/v1/order/open?userId=${USER_ID}&market=${MARKET}`
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
                await axios.post(`${BASE_URL}/api/v1/order`, {
                    market: MARKET,
                  
                    price:    (mid - Math.random()).toFixed(1).toString(),
                    quantity: "1",
                    side:     "buy",
                    userId:   USER_ID
                });
                bidsToAdd--;
            }

            if (asksToAdd > 0) {
                await axios.post(`${BASE_URL}/api/v1/order`, {
                    market: MARKET,
                    // Asks also placed near mid so they cross with bids and
                    // generate real trades → chart moves
                    price:    (mid - Math.random()).toFixed(1).toString(),
                    quantity: "1",
                    side:     "sell",
                    userId:   USER_ID
                });
                asksToAdd--;
            }
        }

        consecutiveErrors = 0;
        console.log(
            `[${new Date().toLocaleTimeString()}] ✅ mid=${mid.toFixed(1)}` +
            `  bids=${TOTAL_BIDS}  asks=${TOTAL_ASKS}` +
            `  cancelled(bid=${cancelledBids} ask=${cancelledAsks})`
        );
    } catch (err: any) {
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
        axios.delete(`${BASE_URL}/api/v1/order`, {
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
        axios.delete(`${BASE_URL}/api/v1/order`, {
            data: { orderId: o.orderId, market: MARKET }
        })
    ));

    return toCancel.length;
}

console.log(
    `🚀 Market Maker started — market=${MARKET}  userId=${USER_ID}` +
    `  interval=${INTERVAL}ms  staleSpread=${STALE_SPREAD}  churn=${RANDOM_CHURN * 100}%`
);
setInterval(main, INTERVAL);
main();