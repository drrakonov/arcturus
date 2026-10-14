export * from './validation.js';
import type { ErrorCode } from './validation.js';
// Shared wire contracts. Numeric order/fill fields are display values, never settlement inputs.
export interface Order {
    price: number;
    quantity: number;
    orderId: string;
    filled: number;
    side: "buy" | "sell";
    userId: string;
}

export const CREATE_ORDER = "CREATE_ORDER";
export const CANCEL_ORDER = "CANCEL_ORDER";
export const ON_RAMP = "ON_RAMP";
export const CREATE_MARKET = "CREATE_MARKET";

export const GET_DEPTH = "GET_DEPTH";
export const GET_OPEN_ORDERS = "GET_OPEN_ORDERS";

export interface AccountSnapshot {
    userId: string;
    generation: string;
    revision: number;
    balances: Record<string, { available: string; locked: string }>;
    openOrders: (Order & { market: string })[];
}
export interface RecentTrade { id: string; price: string; quantity: string; isBuyerMaker: boolean; timestamp: number }
export interface MarketSnapshot {
    market: string; generation: string; revision: number;
    bids: [string, string][]; asks: [string, string][]; trades: RecentTrade[];
}
export type MessageFromApi = {
    type: 'CREATE_ACCOUNT' | 'GET_ACCOUNT', data: { userId: string }
} | {
    type: 'GET_MARKET', data: { market: string }
} | {
    type: typeof CREATE_ORDER,
    data: {
        market: string,
        price: string,
        quantity: string,
        side: "buy" | "sell",
        userId: string
    }
} | {
    type: typeof CANCEL_ORDER,
    data: {
        orderId: string,
        market: string,
        userId: string
    }
} | {
    type: typeof ON_RAMP,
    data: {
        amount: string,
        userId: string,
        txnId: string
    }
} | {
    type: typeof GET_DEPTH,
    data: {
        market: string
    }
} | {
    type: typeof GET_OPEN_ORDERS,
    data: {
        userId: string,
        market: string
    }
} | {
    type: typeof CREATE_MARKET,
    data: {
        baseAsset: string   // e.g. "ETH" — quote asset is always INR
    }
}
export type MessageToApi = {
    type: 'ACCOUNT', payload: AccountSnapshot
} | {
    type: 'MARKET', payload: MarketSnapshot
} | {
    type: "ERROR",
    payload: { code: ErrorCode; message: string }
} | {
    type: "ACK",
    payload: { message: string }
} | {
    type: "DEPTH",
    payload: {
        bids: [string, string][],
        asks: [string, string][],
    }
} | {
    type: "ORDER_PLACED",
    payload: {
        orderId: string,
        executedQty: number,
        fills: {
            price: string,
            qty: number,
            tradeId: number
        }[]
    }
} | {
    type: "ORDER_CANCELLED",
    payload: {
        orderId: string,
        executedQty: number,
        remainingQty: number
    }
} | {
    type: "OPEN_ORDERS",
    payload: Order[]
}
export type TickerUpdateMessage = {
    stream: string,
    data: {
        c?: string,
        h?: string,
        l?: string,
        v?: string,
        V?: string,
        s?: string,
        id: number,
        e: "ticker"
    }
}

export type DepthUpdateMessage = {
    stream: string,
    data: {
        b?: [string, string][],
        a?: [string, string][],
        e: "depth"
    }
}

export type TradeAddedMessage = {
    stream: string,
    data: {
        e: "trade",
        t: number,
        m: boolean,
        p: string,
        q: string,
        s: string, // symbol
    }
}

export type WsMessage = TickerUpdateMessage | DepthUpdateMessage | TradeAddedMessage |
    { stream: string; data: { e: 'account'; snapshot: AccountSnapshot } } |
    { stream: string; data: { e: 'market'; snapshot: MarketSnapshot } };

export const SUBSCRIBE = "SUBSCRIBE";
export const UNSUBSCRIBE = "UNSUBSCRIBE";

export type SubscribeMessage = {
    method: typeof SUBSCRIBE,
    params: string[]
}

export type UnsubscribeMessage = {
    method: typeof UNSUBSCRIBE,
    params: string[]
}

export type IncomingMessage = SubscribeMessage | UnsubscribeMessage;
// Type constants — must match what the engine publishes
export const TRADE_ADDED = "TRADE_ADDED" as const;
export const ORDER_UPDATE = "ORDER_UPDATE" as const;

// ---------- TRADE_ADDED payload ----------
export interface TradeAddedData {
    id: string;
    isBuyerMaker: boolean;
    price: string;
    quantity: string;
    quoteQuantity: string;
    timestamp: number;   // Unix ms from engine
    market: string;
}

// ---------- ORDER_UPDATE payload ----------
// Full update (new order placed)
export interface OrderUpdateDataFull {
    orderId: string;
    executedQty: number;
    market: string;
    price: string;
    quantity: string;
    side: "buy" | "sell";
}

// Partial update (only fill progress for an existing order)
export interface OrderUpdateDataPartial {
    orderId: string;
    executedQty: number;
    market?: undefined;
    price?: undefined;
    quantity?: undefined;
    side?: undefined;
}

export type OrderUpdateData = OrderUpdateDataFull | OrderUpdateDataPartial;

// ---------- Discriminated union of all DB messages ----------
export type DbMessage =
    | { type: typeof TRADE_ADDED; data: TradeAddedData }
    | { type: typeof ORDER_UPDATE; data: OrderUpdateData };
