import type { MessageFromApi } from './index.js';

export type ErrorCode = 'INVALID_REQUEST' | 'UNKNOWN_MARKET' | 'UNKNOWN_USER' |
    'INSUFFICIENT_FUNDS' | 'ORDER_NOT_FOUND' | 'LIMIT_EXCEEDED' | 'DUPLICATE_TRANSACTION' | 'INTERNAL_ERROR' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'REQUEST_CONFLICT' | 'REQUEST_TIMEOUT' | 'SERVICE_UNAVAILABLE' | 'NO_LIQUIDITY';
export class TradingError extends Error {
    constructor(public code: ErrorCode, message: string) { super(message); }
}
export const PRICE_DECIMALS = 2;
export const QUANTITY_DECIMALS = 4;
export const BALANCE_DECIMALS = 6;
export const MAX_INPUT = 1_000_000n;

// Parse decimal text directly: no floating point, exponent notation or silent rounding.
export function parseDecimal(value: unknown, decimals: number, max = MAX_INPUT): bigint {
    if (typeof value !== 'string' || value.length > 40 ||
        !new RegExp(`^(0|[1-9][0-9]*)(\\.[0-9]{1,${decimals}})?$`).test(value)) {
        throw new TradingError('INVALID_REQUEST', `Expected a positive decimal string with at most ${decimals} decimal places`);
    }
    const [whole, fraction = ''] = value.split('.');
    const units = BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
    if (units <= 0n || units > max * 10n ** BigInt(decimals)) {
        throw new TradingError('INVALID_REQUEST', `Amount must be greater than zero and at most ${max}`);
    }
    return units;
}
export function formatDecimal(units: bigint, decimals: number): string {
    const scale = 10n ** BigInt(decimals);
    const fraction = (units % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${units / scale}${fraction ? `.${fraction}` : ''}`;
}
export function identifier(value: unknown, label: string): asserts value is string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(value)) {
        throw new TradingError('INVALID_REQUEST', `Invalid ${label}`);
    }
}
export function validateMessage(value: unknown): MessageFromApi {
    if (!value || typeof value !== 'object') throw new TradingError('INVALID_REQUEST', 'Expected a command');
    const { type, data } = value as { type?: unknown; data?: any };
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TradingError('INVALID_REQUEST', 'Expected command data');
    if (['CREATE_ORDER', 'MARKET_ORDER', 'CANCEL_ORDER', 'GET_DEPTH', 'GET_OPEN_ORDERS', 'GET_MARKET'].includes(String(type))) {
        if (typeof data.market !== 'string' || !/^[A-Z][A-Z0-9]{0,11}_INR$/.test(data.market))
            throw new TradingError('INVALID_REQUEST', 'Invalid market');
    }
    switch (type) {
        case 'RUN_SCENARIO':
            identifier(data.userId, 'userId');
            if (!['partial-fill', 'price-improvement', 'fifo'].includes(data.scenario)) throw new TradingError('INVALID_REQUEST', 'Unknown scenario');
            break;
        case 'MARKET_ORDER':
        case 'CREATE_ORDER':
            identifier(data.userId, 'userId');
            if (data.side !== 'buy' && data.side !== 'sell') throw new TradingError('INVALID_REQUEST', 'Invalid side');
            parseDecimal(type === 'MARKET_ORDER' ? data.protectionPrice : data.price, PRICE_DECIMALS);
            parseDecimal(data.quantity, QUANTITY_DECIMALS);
            break;
        case 'CANCEL_ORDER': identifier(data.orderId, 'orderId'); identifier(data.userId, 'userId'); break;
        case 'GET_OPEN_ORDERS': identifier(data.userId, 'userId'); break;
        case 'GET_DEPTH': case 'GET_MARKET': break;
        case 'CREATE_ACCOUNT': case 'GET_ACCOUNT': identifier(data.userId, 'userId'); break;
        case 'ON_RAMP':
            identifier(data.userId, 'userId'); identifier(data.txnId, 'txnId');
            parseDecimal(data.amount, BALANCE_DECIMALS); break;
        case 'CREATE_MARKET':
            if (typeof data.baseAsset !== 'string' || !/^[A-Z][A-Z0-9]{0,11}$/.test(data.baseAsset) || data.baseAsset === 'INR')
                throw new TradingError('INVALID_REQUEST', 'Invalid base asset');
            break;
        default: throw new TradingError('INVALID_REQUEST', 'Unknown command');
    }
    return value as MessageFromApi;
}
