import { randomUUID } from 'node:crypto';
import { TradingError, validateMessage, parseDecimal, formatDecimal } from '@arcturus/contracts';
import type { DbMessage, MessageToApi, WsMessage, AccountSnapshot, MarketSnapshot, RecentTrade, Candle, CandleInterval, HistoryOrder, HistoryTrade, TraceEvent, ScenarioKind, ScenarioResult } from '@arcturus/contracts';
import { Orderbook, toWireOrder, type BookOrder, type Fill } from './orderbook.js';

import { addFill } from './candles.js';

export const BASE_CURRENCY = 'INR';
type Balance = { available: bigint; locked: bigint };
type Balances = Map<string, Record<string, Balance>>;
export interface EngineSink {
    trace?(userId: string, event: TraceEvent): void;
    pushMessage(message: DbMessage): void;
    publishMessage(channel: string, message: WsMessage): void;
    sendToApi(clientId: string, message: MessageToApi): void;
}
const noop: EngineSink = { pushMessage() {}, publishMessage() {}, sendToApi() {} };
const numberQty = (q: bigint) => Number(formatDecimal(q, 4));
const cloneBalances = (balances: Balances): Balances => new Map([...balances].map(([id, assets]) =>
    [id, Object.fromEntries(Object.entries(assets).map(([asset, b]) => [asset, { ...b }]))]));
const asset = (balances: Balances, userId: string, symbol: string): Balance => {
    const user = balances.get(userId);
    if (!user) throw new TradingError('UNKNOWN_USER', 'Unknown user');
    return user[symbol] ??= { available: 0n, locked: 0n };
};
const invariant = (ok: boolean, message: string) => {
    if (!ok) throw new Error(`Trading invariant violated: ${message}`);
};

export class Engine {
    private orderbooks: Orderbook[] = [];
    private balances: Balances = new Map();
    private generation = randomUUID();
    private historyId = randomUUID();
    private revision = 0;
    private traceId: string | undefined;
    private recentTrades = new Map<string, RecentTrade[]>();
    private candles = new Map<string, Record<CandleInterval, Candle[]>>();
    private requests = new Map<string, { fingerprint: string; expires: number; response: MessageToApi }>();
    private usedTxnIds = new Set<string>();
    private sink: EngineSink;
    private orderId: () => string;
    private now: () => number;
    constructor(options: { sink?: EngineSink; orderId?: () => string; now?: () => number; snapshot?: unknown; baseAsset?: string } = {}) {
        this.sink = options.sink ?? noop;
        this.orderId = options.orderId ?? randomUUID;
        this.now = options.now ?? Date.now;
        if (options.snapshot !== undefined) this.restore(options.snapshot);
        else {
            this.orderbooks = [new Orderbook(options.baseAsset ?? 'SOL')];
            for (const id of ['1', '2', '5']) this.balances.set(id, {
                INR: { available: 10_000_000_000_000n, locked: 0n },
                [options.baseAsset ?? 'SOL']: { available: 10_000_000_000_000n, locked: 0n },
            });
        }
        this.assertState(this.orderbooks, this.balances);
    }
    private book(market: string) {
        const book = this.orderbooks.find(b => b.ticker() === market);
        if (!book) throw new TradingError('UNKNOWN_MARKET', 'Unknown market');
        return book;
    }
    // One synchronous transaction per command. Publish failures cannot turn a committed
    // trade into a business rejection; durable delivery/replay remains a later milestone.
    private emit(action: () => void) {
        try { action(); } catch (error) { console.error('Engine event delivery failed after commit', error); }
    }
    process({ message, clientId, requestId, expiresAt }: { message: unknown; clientId: string; requestId?: string; expiresAt?: number }): MessageToApi {
        let response: MessageToApi;
        let cacheKey: string | undefined;
        let fingerprint = '';
        this.traceId = clientId;
        let actor: string | undefined;
        try {
            if (expiresAt !== undefined && this.now() > expiresAt) throw new TradingError('REQUEST_TIMEOUT', 'Command expired before execution');
            const command = validateMessage(message);
            if (['CREATE_ORDER', 'MARKET_ORDER', 'CANCEL_ORDER', 'RUN_SCENARIO'].includes(command.type) && 'userId' in command.data) actor = command.data.userId;
            if (requestId && ['CREATE_ORDER', 'MARKET_ORDER', 'CANCEL_ORDER', 'RUN_SCENARIO'].includes(command.type)) {
                if (!/^[A-Za-z0-9-]{8,64}$/.test(requestId)) throw new TradingError('INVALID_REQUEST', 'Invalid request ID');
                for (const [key, value] of this.requests) if (value.expires <= this.now()) this.requests.delete(key);
                const key = `${'userId' in command.data ? command.data.userId : ''}:${requestId}`;
                fingerprint = JSON.stringify(command);
                const cached = this.requests.get(key);
                if (cached) {
                    if (cached.fingerprint !== fingerprint) throw new TradingError('REQUEST_CONFLICT', 'Request ID was already used with different fields');
                    this.emit(() => this.sink.sendToApi(clientId, cached.response));
                    if (actor) this.trace(actor, 'engine_replayed');
                    this.traceId = undefined;
                    return structuredClone(cached.response);
                }
                if (this.requests.size >= 10_000) throw new TradingError('LIMIT_EXCEEDED', 'Request cache full; retry later');
                cacheKey = key;
            }
            switch (command.type) {
                case 'CREATE_ACCOUNT':
                    this.createAccount(command.data.userId);
                    response = { type: 'ACCOUNT', payload: this.getAccount(command.data.userId) }; break;
                case 'GET_ACCOUNT': response = { type: 'ACCOUNT', payload: this.getAccount(command.data.userId) }; break;
                case 'GET_MARKET': response = { type: 'MARKET', payload: this.getMarket(command.data.market) }; break;
                case 'RUN_SCENARIO': response = { type: 'SCENARIO', payload: this.runScenario(command.data.userId, command.data.scenario) }; break;
                case 'MARKET_ORDER': {
                    const d = command.data;
                    response = { type: 'ORDER_PLACED', payload: this.createOrder(d.market, d.protectionPrice, d.quantity, d.side, d.userId, true) }; break;
                }
                case 'CREATE_ORDER': {
                    const d = command.data;
                    response = { type: 'ORDER_PLACED', payload: this.createOrder(d.market, d.price, d.quantity, d.side, d.userId) };
                    break;
                }
                case 'CANCEL_ORDER': response = { type: 'ORDER_CANCELLED', payload: this.cancelOrder(command.data.market, command.data.orderId, command.data.userId) }; break;
                case 'GET_DEPTH': response = { type: 'DEPTH', payload: this.book(command.data.market).getDepth() }; break;
                case 'GET_OPEN_ORDERS':
                    if (!this.balances.has(command.data.userId)) throw new TradingError('UNKNOWN_USER', 'Unknown user');
                    response = { type: 'OPEN_ORDERS', payload: this.book(command.data.market).getOpenOrders(command.data.userId) }; break;
                case 'ON_RAMP': this.onRamp(command.data.userId, command.data.amount, command.data.txnId);
                    response = { type: 'ACK', payload: { message: 'Simulated funds credited' } }; break;
                case 'CREATE_MARKET':
                    if (this.orderbooks.some(b => b.baseAsset === command.data.baseAsset))
                        throw new TradingError('INVALID_REQUEST', 'Market already exists');
                    if (this.orderbooks.length >= 32) throw new TradingError('LIMIT_EXCEEDED', 'Market limit reached');
                    this.orderbooks.push(new Orderbook(command.data.baseAsset));
                    response = { type: 'ACK', payload: { message: 'Market created' } }; break;
            }
        } catch (error) {
            if (!(error instanceof TradingError)) console.error('Engine rejected command', error);
            response = { type: 'ERROR', payload: error instanceof TradingError ?
                { code: error.code, message: error.message } : { code: 'INTERNAL_ERROR', message: 'Trading command failed' } };
        }
        if (cacheKey) this.requests.set(cacheKey, { fingerprint, expires: this.now() + 600_000, response: structuredClone(response) });
        if (actor) this.trace(actor, response.type === 'ERROR' ? 'engine_rejected' : 'engine_committed',
            'orderId' in response.payload ? response.payload.orderId as string : undefined);
        this.traceId = undefined;
        this.emit(() => this.sink.sendToApi(clientId, response));
        return response;
    }
    createOrder(market: string, price: string, quantity: string, side: 'buy' | 'sell', userId: string, immediate = false) {
        validateMessage({ type: 'CREATE_ORDER', data: { market, price, quantity, side, userId } });
        const original = this.book(market);
        if (original.bids.length + original.asks.length >= 10_000 || original.lastTradeId > Number.MAX_SAFE_INTEGER - 10_000)
            throw new TradingError('LIMIT_EXCEEDED', 'Book capacity reached');
        const book = original.clone();
        const balances = cloneBalances(this.balances);
        const timestamp = this.now();
        const order: BookOrder = { createdAt: timestamp, orderType: immediate ? 'market' : 'limit', price: parseDecimal(price, 2), quantity: parseDecimal(quantity, 4),
            side, userId, orderId: this.orderId(), filled: 0n };
        const reserve = side === 'buy' ? order.price * order.quantity : order.quantity * 100n;
        const funds = asset(balances, userId, side === 'buy' ? book.quoteAsset : book.baseAsset);
        if (funds.available < reserve) throw new TradingError('INSUFFICIENT_FUNDS', 'Insufficient available funds');
        funds.available -= reserve;
        funds.locked += reserve;
        const { fills, executedQty } = book.addOrder(order);
        for (const fill of fills) {
            const buyer = side === 'buy' ? userId : fill.otherUserId;
            const seller = side === 'sell' ? userId : fill.otherUserId;
            const buyerQuote = asset(balances, buyer, book.quoteAsset);
            const buyerBase = asset(balances, buyer, book.baseAsset);
            const sellerQuote = asset(balances, seller, book.quoteAsset);
            const sellerBase = asset(balances, seller, book.baseAsset);
            const cost = fill.price * fill.qty;
            const held = (side === 'buy' ? order.price : fill.price) * fill.qty;
            buyerQuote.locked -= held;
            buyerQuote.available += held - cost; // Release price improvement immediately.
            sellerQuote.available += cost;
            sellerBase.locked -= fill.qty * 100n;
            buyerBase.available += fill.qty * 100n;
        }
        const cancelled = immediate ? order.quantity - order.filled : 0n;
        if (immediate && !fills.length) throw new TradingError('NO_LIQUIDITY', 'No liquidity within the protection price; nothing executed');
        if (cancelled > 0n) {
            const release = cancelled * (side === 'buy' ? order.price : 100n);
            funds.locked -= release; funds.available += release;
            book.bids = book.bids.filter(o => o.orderId !== order.orderId);
            book.asks = book.asks.filter(o => o.orderId !== order.orderId);
        }
        this.commit(original, book, balances);
        this.revision++;
        this.emit(() => this.publishOrder(order, fills, market, original, timestamp, cancelled > 0n));
        this.emit(() => this.publishDepth(original, book));
        const recent = this.recentTrades.get(market) ?? [];
        const candles = this.candles.get(market) ?? { '5s': [], '1m': [] };
        for (const fill of fills) {
            recent.unshift({ id: String(fill.tradeId), price: formatDecimal(fill.price, 2),
                quantity: formatDecimal(fill.qty, 4), isBuyerMaker: side === 'sell', timestamp });
            for (const interval of ['5s', '1m'] as const) addFill(candles[interval], fill.price, fill.qty, timestamp, interval);
        }
        this.candles.set(market, candles);
        this.recentTrades.set(market, recent.slice(0, 50));
        this.notify(market, [userId, ...fills.map(f => f.otherUserId)]);
        return { orderId: order.orderId, executedQty: numberQty(executedQty), ...(immediate ? { cancelledQty: numberQty(cancelled) } : {}),
            fills: fills.map(f => ({ price: formatDecimal(f.price, 2), qty: numberQty(f.qty), tradeId: f.tradeId })) };
    }
    cancelOrder(market: string, orderId: string, userId: string) {
        validateMessage({ type: 'CANCEL_ORDER', data: { market, orderId, userId } });
        const original = this.book(market);
        const book = original.clone();
        const order = [...book.bids, ...book.asks].find(o => o.orderId === orderId);
        if (!order || order.userId !== userId) throw new TradingError('ORDER_NOT_FOUND', 'Open order not found');
        const balances = cloneBalances(this.balances);
        const remaining = order.quantity - order.filled;
        const funds = asset(balances, order.userId, order.side === 'buy' ? book.quoteAsset : book.baseAsset);
        const release = order.side === 'buy' ? remaining * order.price : remaining * 100n;
        funds.locked -= release;
        funds.available += release;
        book.bids = book.bids.filter(o => o.orderId !== orderId);
        book.asks = book.asks.filter(o => o.orderId !== orderId);
        this.commit(original, book, balances);
        this.emit(() => this.publishDepth(original, book));
        this.revision++;
        const timestamp = this.now();
        this.emit(() => this.sink.pushMessage({ type: 'PERSISTENCE_BATCH', version: 1,
            eventId: randomUUID(), traceId: this.traceId, historyId: this.historyId, revision: this.revision, timestamp,
            orders: [this.historyOrder(order, market, timestamp, true)], trades: [] }));
        this.notify(market, [userId]);
        return { orderId, executedQty: numberQty(order.filled), remainingQty: numberQty(remaining) };
    }
    private createAccount(userId: string) {
        if (this.balances.has(userId)) return;
        if (this.balances.size >= 1000) throw new TradingError('LIMIT_EXCEEDED', 'Demo account capacity reached');
        this.balances.set(userId, { INR: { available: 100_000_000_000n, locked: 0n }, [this.orderbooks[0]!.baseAsset]: { available: 100_000_000n, locked: 0n } });
        this.revision++;
    }
    getAccount(userId: string): AccountSnapshot {
        const balances = this.balances.get(userId);
        if (!balances) throw new TradingError('UNKNOWN_USER', 'Demo account unavailable; start a new session');
        return { userId, generation: this.generation, revision: this.revision,
            balances: Object.fromEntries(Object.entries(balances).map(([symbol, b]) =>
                [symbol, { available: formatDecimal(b.available, 6), locked: formatDecimal(b.locked, 6) }])),
            openOrders: this.orderbooks.flatMap(book => [...book.bids, ...book.asks]
                .filter(o => o.userId === userId).map(o => ({ ...toWireOrder(o), market: book.ticker() }))) };
    }
    getMarket(market: string, history = true): MarketSnapshot {
        const depth = this.book(market).getDepth();
        return { market, generation: this.generation, historyId: this.historyId, revision: this.revision,
            bids: depth.bids.slice(0, 20), asks: depth.asks.slice(0, 20), trades: structuredClone(this.recentTrades.get(market) ?? []),
            candleHistory: history, candles: Object.fromEntries((['5s', '1m'] as const).map(interval =>
                [interval, structuredClone(history ? this.candles.get(market)?.[interval] ?? [] : this.candles.get(market)?.[interval].slice(-1) ?? [])])) as Record<CandleInterval, Candle[]> };
    }
    private notify(market: string, users: string[]) {
        this.emit(() => this.sink.publishMessage(`market@${market}`, { stream: `market@${market}`, data: { e: 'market', snapshot: this.getMarket(market, false) } }));
        for (const userId of new Set(users)) this.emit(() => this.sink.publishMessage(`account@${userId}`,
            { stream: `account@${userId}`, data: { e: 'account', snapshot: this.getAccount(userId) } }));
    }
    private commit(original: Orderbook, book: Orderbook, balances: Balances) {
        const books = this.orderbooks.map(b => b === original ? book : b);
        this.assertState(books, balances);
        const total = (state: Balances) => {
            const totals = new Map<string, bigint>();
            for (const assets of state.values()) for (const [symbol, b] of Object.entries(assets))
                totals.set(symbol, (totals.get(symbol) ?? 0n) + b.available + b.locked);
            return totals;
        };
        const before = total(this.balances), after = total(balances);
        for (const symbol of new Set([...before.keys(), ...after.keys()]))
            invariant((before.get(symbol) ?? 0n) === (after.get(symbol) ?? 0n), `conservation of ${symbol}`);
        this.orderbooks = books;
        this.balances = balances;
    }
    private assertState(books: Orderbook[], balances: Balances) {
        const required = new Map<string, Map<string, bigint>>();
        const ids = new Set<string>();
        const markets = new Set<string>();
        invariant(books.length <= 32 && balances.size <= 1000, 'state capacity');
        for (const book of books) {
            invariant(!markets.has(book.ticker()), 'duplicate market'); markets.add(book.ticker());
            invariant(book.bids.length + book.asks.length <= 10_000, 'book capacity');
            invariant(Number.isSafeInteger(book.lastTradeId) && book.lastTradeId >= 0, 'trade counter');
            invariant(book.currentPrice >= 0n && book.currentPrice <= 100_000_000n, 'last price');
            for (const [side, orders] of [['buy', book.bids], ['sell', book.asks]] as const) for (const o of orders) {
                validateMessage({ type: 'CREATE_ORDER', data: { market: book.ticker(), price: formatDecimal(o.price, 2),
                    quantity: formatDecimal(o.quantity, 4), side: o.side, userId: o.userId } });
                invariant(o.side === side && o.filled >= 0n && o.filled < o.quantity, 'live order quantities/side');
                invariant(!ids.has(o.orderId), 'duplicate order id'); ids.add(o.orderId);
                validateMessage({ type: 'CANCEL_ORDER', data: { market: book.ticker(), orderId: o.orderId, userId: o.userId } });
                invariant(balances.has(o.userId), 'maker account exists');
                const symbol = side === 'buy' ? book.quoteAsset : book.baseAsset;
                const amount = (o.quantity - o.filled) * (side === 'buy' ? o.price : 100n);
                const user = required.get(o.userId) ?? new Map<string, bigint>();
                user.set(symbol, (user.get(symbol) ?? 0n) + amount); required.set(o.userId, user);
            }
            const bestBid = book.bids.reduce((p, o) => o.price > p ? o.price : p, 0n);
            invariant(book.asks.every(o => o.price > bestBid), 'uncrossed book');
        }
        for (const [id, assets] of balances) {
            for (const [symbol, b] of Object.entries(assets)) {
                invariant(b.available >= 0n && b.locked >= 0n, 'nonnegative balances');
                invariant(b.locked === (required.get(id)?.get(symbol) ?? 0n), 'exact open-order reserves');
            }
            for (const symbol of required.get(id)?.keys() ?? []) invariant(!!assets[symbol], 'reserved asset exists');
        }
    }
    onRamp(userId: string, amount: string, txnId: string) {
        validateMessage({ type: 'ON_RAMP', data: { userId, amount, txnId } });
        if (this.usedTxnIds.has(txnId)) throw new TradingError('DUPLICATE_TRANSACTION', 'Transaction already credited');
        if (this.usedTxnIds.size >= 10_000 || (!this.balances.has(userId) && this.balances.size >= 1000))
            throw new TradingError('LIMIT_EXCEEDED', 'Demo funding capacity reached');
        const balances = cloneBalances(this.balances);
        if (!balances.has(userId)) balances.set(userId, {});
        asset(balances, userId, BASE_CURRENCY).available += parseDecimal(amount, 6);
        this.assertState(this.orderbooks, balances);
        this.balances = balances;
        this.usedTxnIds.add(txnId);
    }
    private trace(userId: string, stage: TraceEvent['stage'], orderId?: string) {
        if (this.traceId) this.emit(() => this.sink.trace?.(userId, { id: randomUUID(), traceId: this.traceId!, at: this.now(), stage, ...(orderId ? { orderId } : {}) }));
    }
    private runScenario(userId: string, scenario: ScenarioKind): ScenarioResult {
        this.getAccount(userId); // The caller must own a real provisioned session.
        const batches: import('@arcturus/contracts').PersistenceBatch[] = [];
        const demo = new Engine({ baseAsset: 'DEMO', now: this.now, sink: {
            publishMessage() {}, sendToApi() {},
            pushMessage: event => {
                if (event.type !== 'PERSISTENCE_BATCH') return;
                event.traceId = this.traceId; batches.push(event);
                this.emit(() => this.sink.pushMessage(event));
            },
        } });
        const maker = randomUUID();
        demo.createAccount(userId); demo.createAccount(maker);
        const steps: ScenarioResult['steps'] = [];
        const place = (label: string, side: 'buy' | 'sell', price: string, qty: string, actor: string) => {
            const result = demo.createOrder('DEMO_INR', price, qty, side, actor);
            steps.push({ label, orderId: result.orderId, executedQty: result.executedQty }); return result;
        };
        let inspectedOrderId: string;
        if (scenario === 'partial-fill') {
            const sell = place('Rest a sell order for 3', 'sell', '9', '3', userId);
            place('Buy 1 at a limit of 10', 'buy', '10', '1', maker);
            const result = demo.cancelOrder('DEMO_INR', sell.orderId, userId);
            steps.push({ label: 'Cancel the remaining 2', orderId: sell.orderId, executedQty: result.executedQty, cancelledQty: result.remainingQty });
            inspectedOrderId = sell.orderId;
        } else {
            place('First maker at 9', 'sell', '9', '1', maker);
            if (scenario === 'fifo') place('Second maker at the same price', 'sell', '9', '1', maker);
            const buy = place(scenario === 'fifo' ? 'Buy 1.5: first maker fills before second' : 'Buy at limit 10: execute at maker price 9',
                'buy', '10', scenario === 'fifo' ? '1.5' : '1', userId);
            inspectedOrderId = buy.orderId;
        }
        // Finish the isolated book cleanly; these cancellations are real engine commands too.
        for (const actor of [userId,maker]) for (const order of demo.getAccount(actor).openOrders) demo.cancelOrder('DEMO_INR', order.orderId, actor);
        return { scenario, historyId: demo.historyId, market: 'DEMO_INR', inspectedOrderId, steps,
            fills: batches.flatMap(b => b.trades.map(t => ({ makerOrderId: t.makerOrderId, takerOrderId: t.takerOrderId, price: t.price, quantity: t.quantity }))),
            orders: [...new Map(batches.flatMap(b => b.orders).map(o => [o.orderId, o])).values()].filter(o => o.userId === userId) };
    }
    private historyOrder(order: BookOrder, market: string, timestamp: number, cancelled = false): HistoryOrder {
        return { orderId: order.orderId, userId: order.userId, market, side: order.side, orderType: order.orderType ?? 'limit',
            price: formatDecimal(order.price, 2), quantity: formatDecimal(order.quantity, 4),
            executedQty: formatDecimal(order.filled, 4), createdAt: order.createdAt ?? timestamp, updatedAt: timestamp,
            status: cancelled ? 'cancelled' : order.filled === order.quantity ? 'filled' : order.filled > 0n ? 'partially_filled' : 'open' };
    }
    private publishOrder(order: BookOrder, fills: Fill[], market: string, before: Orderbook, timestamp: number, cancelled = false) {
        const makers = new Map([...before.bids, ...before.asks].map(o => [o.orderId, { ...o }]));
        const orders = [this.historyOrder(order, market, timestamp, cancelled)];
        const trades: HistoryTrade[] = [];
        for (const f of fills) {
            const maker = makers.get(f.makerOrderId)!;
            maker.filled += f.qty;
            orders.push(this.historyOrder(maker, market, timestamp));
            trades.push({ id: `${this.historyId}:${market}:${f.tradeId}`, sequence: f.tradeId,
                isBuyerMaker: order.side === 'sell', price: formatDecimal(f.price, 2), quantity: formatDecimal(f.qty, 4),
                quoteQuantity: formatDecimal(f.price * f.qty, 6), market, timestamp,
                buyerId: order.side === 'buy' ? order.userId : f.otherUserId,
                sellerId: order.side === 'sell' ? order.userId : f.otherUserId,
                makerOrderId: f.makerOrderId, takerOrderId: order.orderId });
        }
        this.sink.pushMessage({ type: 'PERSISTENCE_BATCH', version: 1, eventId: randomUUID(), traceId: this.traceId,
            historyId: this.historyId, revision: this.revision, timestamp, orders, trades });
        for (const f of fills) {
            this.sink.publishMessage(`trade@${market}`, { stream: `trade@${market}`,
                data: { e: 'trade', t: f.tradeId, m: order.side === 'sell', p: formatDecimal(f.price, 2), q: formatDecimal(f.qty, 4), s: market } });
        }
        if (fills.length) {
            const prices = fills.map(f => f.price);
            const high = prices.reduce((a, b) => a > b ? a : b);
            const low = prices.reduce((a, b) => a < b ? a : b);
            this.sink.publishMessage(`ticker@${market}`, { stream: `ticker@${market}`, data: {
                e: 'ticker', id: this.now(), s: market, c: formatDecimal(fills[fills.length - 1]!.price, 2),
                h: formatDecimal(high, 2), l: formatDecimal(low, 2),
                v: formatDecimal(fills.reduce((sum, f) => sum + f.qty, 0n), 4),
                V: formatDecimal(fills.reduce((sum, f) => sum + f.price * f.qty, 0n), 6),
            } });
        }
    }
    private publishDepth(before: Orderbook, after: Orderbook) {
        const previous = before.getDepth(), current = after.getDepth();
        const changes = (old: [string, string][], next: [string, string][]): [string, string][] => {
            const a = new Map(old), b = new Map(next);
            return [...new Set([...a.keys(), ...b.keys()])].filter(p => a.get(p) !== b.get(p))
                .map(p => [p, b.get(p) ?? '0']);
        };
        const a = changes(previous.asks, current.asks), b = changes(previous.bids, current.bids);
        if (a.length || b.length) this.sink.publishMessage(`depth@${after.ticker()}`, {
            stream: `depth@${after.ticker()}`, data: { e: 'depth', a, b },
        });
    }
    getSnapshot() {
        return { version: 2, historyId: this.historyId, generation: this.generation, revision: this.revision, requests: [...this.requests],
            candles: [...this.candles], recentTrades: [...this.recentTrades], orderbooks: this.orderbooks.map(b => ({ baseAsset: b.baseAsset,
            bids: b.bids.map(o => ({ ...o, price: String(o.price), quantity: String(o.quantity), filled: String(o.filled) })),
            asks: b.asks.map(o => ({ ...o, price: String(o.price), quantity: String(o.quantity), filled: String(o.filled) })),
            lastTradeId: b.lastTradeId, currentPrice: String(b.currentPrice) })),
            balances: [...this.balances].map(([id, assets]) => [id, Object.fromEntries(Object.entries(assets)
                .map(([symbol, b]) => [symbol, { available: String(b.available), locked: String(b.locked) }]))]),
            usedTxnIds: [...this.usedTxnIds] };
    }
    private restore(snapshot: any) {
        if (snapshot?.version !== 2) throw new Error('Incompatible snapshot: Milestone 1 requires version 2; start a fresh isolated demo');
        if (snapshot.orderbooks?.some((book: any) => book.baseAsset === 'TATA')) {
            throw new Error('Legacy TATA snapshot: preserve it and start a fresh SOL demo with WITH_SNAPSHOT empty; assets and executions are not converted');
        }
        // Each process boot has a new generation, including rollback to an older snapshot.
        this.historyId = snapshot.historyId ?? this.historyId;
        this.revision = snapshot.revision ?? 0;
        this.requests = new Map(snapshot.requests ?? []);
        this.recentTrades = new Map(snapshot.recentTrades ?? []);
        this.candles = new Map(snapshot.candles ?? []);
        const units = (value: unknown) => {
            if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(value)) throw new Error('Invalid snapshot units');
            return BigInt(value);
        };
        this.orderbooks = snapshot.orderbooks.map((b: any) => {
            validateMessage({ type: 'CREATE_MARKET', data: { baseAsset: b.baseAsset } });
            const orders = (list: any[]) => list.map(o => ({ ...o, price: units(o.price), quantity: units(o.quantity), filled: units(o.filled) }));
            return new Orderbook(b.baseAsset, orders(b.bids), orders(b.asks), b.lastTradeId, units(b.currentPrice));
        });
        this.balances = new Map(snapshot.balances.map(([id, assets]: [string, Record<string, any>]) => {
            validateMessage({ type: 'GET_OPEN_ORDERS', data: { userId: id, market: 'SOL_INR' } });
            return [id, Object.fromEntries(Object.entries(assets).map(([symbol, b]) => {
                if (!/^[A-Z][A-Z0-9]{0,11}$/.test(symbol)) throw new Error('Invalid snapshot asset');
                return [symbol, { available: units(b.available), locked: units(b.locked) }];
            }))];
        }));
        invariant(this.balances.size === snapshot.balances.length, 'unique accounts');
        this.usedTxnIds = new Set(snapshot.usedTxnIds);
        invariant(this.usedTxnIds.size === snapshot.usedTxnIds.length && this.usedTxnIds.size <= 10_000, 'funding ids');
        for (const txnId of this.usedTxnIds) validateMessage({ type: 'ON_RAMP', data: { userId: '1', amount: '1', txnId } });
    }
}
