import { formatDecimal } from "@arcturus/contracts";
import type { Order } from "@arcturus/contracts";

export type { Order } from "@arcturus/contracts";

// Prices in cents, quantities in 1/10,000 units. Wire numbers are display-only.
export interface BookOrder {
    createdAt?: number;
    orderType?: "limit" | "market";
    price: bigint;
    quantity: bigint;
    filled: bigint;
    orderId: string;
    userId: string;
    side: "buy" | "sell";
}

export interface Fill {
    price: bigint;
    qty: bigint;
    tradeId: number;
    otherUserId: string;
    makerOrderId: string;
}

export const toWireOrder = (o: BookOrder): Order => ({
    ...o,
    price: Number(formatDecimal(o.price, 2)),
    quantity: Number(formatDecimal(o.quantity, 4)),
    filled: Number(formatDecimal(o.filled, 4))
});

export class Orderbook {
    readonly quoteAsset = "INR";

    constructor(
        public baseAsset: string,
        public bids: BookOrder[] = [],
        public asks: BookOrder[] = [],
        public lastTradeId = 0,
        public currentPrice = 0n
    ) {}

    ticker() {
        return `${this.baseAsset}_${this.quoteAsset}`;
    }

    clone() {
        return new Orderbook(
            this.baseAsset,
            this.bids.map(o => ({ ...o })),
            this.asks.map(o => ({ ...o })),
            this.lastTradeId,
            this.currentPrice
        );
    }

    addOrder(order: BookOrder): { executedQty: bigint; fills: Fill[] } {
        const opposite = order.side === "buy" ? this.asks : this.bids;
        // Stable sorting preserves arrival order at equal prices, including after partial fills.
        opposite.sort((a, b) =>
            a.price === b.price ? 0 : (a.price < b.price ? -1 : 1) * (order.side === "buy" ? 1 : -1)
        );
        const fills: Fill[] = [];
        for (const maker of opposite) {
            if (
                order.filled === order.quantity ||
                (order.side === "buy" ? maker.price > order.price : maker.price < order.price)
            )
                break;
            const qty =
                order.quantity - order.filled < maker.quantity - maker.filled
                    ? order.quantity - order.filled
                    : maker.quantity - maker.filled;
            maker.filled += qty;
            order.filled += qty;
            this.currentPrice = maker.price;
            fills.push({
                price: maker.price,
                qty,
                tradeId: this.lastTradeId++,
                otherUserId: maker.userId,
                makerOrderId: maker.orderId
            });
        }
        this.bids = this.bids.filter(o => o.filled < o.quantity);
        this.asks = this.asks.filter(o => o.filled < o.quantity);
        if (order.filled < order.quantity)
            (order.side === "buy" ? this.bids : this.asks).push(order);
        return { executedQty: order.filled, fills };
    }

    getDepth() {
        const levels = (orders: BookOrder[], direction: number): [string, string][] => {
            const totals = new Map<bigint, bigint>();
            for (const o of orders)
                totals.set(o.price, (totals.get(o.price) ?? 0n) + o.quantity - o.filled);
            return [...totals]
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0) * direction)
                .map(([p, q]) => [formatDecimal(p, 2), formatDecimal(q, 4)]);
        };
        return { bids: levels(this.bids, -1), asks: levels(this.asks, 1) };
    }

    getOpenOrders(userId: string) {
        return [...this.asks, ...this.bids].filter(o => o.userId === userId).map(toWireOrder);
    }
}
