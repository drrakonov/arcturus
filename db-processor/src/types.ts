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
