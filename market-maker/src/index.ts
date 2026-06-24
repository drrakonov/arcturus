import axios from 'axios';

const BASE_URL = "http://localhost:3000";
const TOTAL_BIDS = 15;
const TOTAL_ASKS = 15;
const MARKET = "TATA_INR";
const USER_ID = "5";

async function main() {
    try {
        const price = 1000 + Math.random() * 20 - 10;
        const openOrders = await axios.get(`${BASE_URL}/api/v1/order/open?userId=${USER_ID}&market=${MARKET}`);

        const ordersArray = openOrders.data.payload ;
        if (!Array.isArray(ordersArray)) {
            console.error("Expected array of orders, got:", ordersArray);
            return;
        }

        const totalBids = ordersArray.filter((o: any) => o.side === "buy").length;
        const totalAsks = ordersArray.filter((o: any) => o.side === "sell").length;

        const cancelledBids = await cancelBidsMoreThan(ordersArray, price);
        const cancelledAsks = await cancelAsksLessThan(ordersArray, price);

        let bidsToAdd = TOTAL_BIDS - totalBids - cancelledBids;
        let asksToAdd = TOTAL_ASKS - totalAsks - cancelledAsks;

        while (bidsToAdd > 0 || asksToAdd > 0) {
            if (bidsToAdd > 0) {
                await axios.post(`${BASE_URL}/api/v1/order`, {
                    market: MARKET,
                    price: (price - Math.random() * 1).toFixed(1).toString(),
                    quantity: "1",
                    side: "buy",
                    userId: USER_ID
                });
                bidsToAdd--;
            }

            if (asksToAdd > 0) {
                await axios.post(`${BASE_URL}/api/v1/order`, {
                    market: MARKET,
                    price: (price - Math.random() * 1).toFixed(1).toString(),
                    quantity: "1",
                    side: "sell",
                    userId: USER_ID
                });
                asksToAdd--;
            }
        }
        console.log(
            `[${new Date().toLocaleTimeString()}] ✅ Orders refreshed — bids: ${TOTAL_BIDS}, asks: ${TOTAL_ASKS}`
        );
    } catch (err: any) {
        console.error(
            `[${new Date().toLocaleTimeString()}] ⚠️ Error: ${err.message}`
        );
    }
}

async function cancelBidsMoreThan(openOrders: any[], price: number) {
    let promises: any[] = [];
    openOrders.map(o => {
        if (o.side === "buy" && (o.price < price || Math.random() < 0.1)) {
            promises.push(axios.delete(`${BASE_URL}/api/v1/order`, {
                data: {
                    orderId: o.orderId,
                    market: MARKET
                }
            }));
        }
    });
    await Promise.all(promises);
    return promises.length;
}

async function cancelAsksLessThan(openOrders: any[], price: number) {
    let promises: any[] = [];
    openOrders.map(o => {
        if (o.side === "sell" && (o.price < price || Math.random() < 0.5)) {
            promises.push(axios.delete(`${BASE_URL}/api/v1/order`, {
                data: {
                    orderId: o.orderId,
                    market: MARKET
                }
            }));
        }
    });

    await Promise.all(promises);
    return promises.length;
}

console.log("🚀 Market Maker Bot started...");
setInterval(main, 2000);
main();