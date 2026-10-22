import { TradingError } from '@arcturus/contracts';
export function queryInteger(value: unknown, fallback: number, min: number, max: number) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(+value) || +value < min || +value > max)
        throw new TradingError('INVALID_REQUEST', 'Invalid history range or limit');
    return +value;
}
export function queryMarket(value: unknown) {
    if (typeof value !== 'string' || !/^[A-Z][A-Z0-9]{0,11}_INR$/.test(value)) throw new TradingError('INVALID_REQUEST', 'Invalid market');
    return value;
}
export function queryHistoryId(value: unknown) {
    if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new TradingError('INVALID_REQUEST', 'historyId from the current market snapshot is required');
    return value;
}
export function decodeCursor(value: unknown): { time: number; id: string } | null {
    if (value === undefined) return null;
    try {
        if (typeof value !== 'string' || value.length > 400 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
        const c = JSON.parse(Buffer.from(value, 'base64url').toString());
        if (!Number.isSafeInteger(c.time) || c.time < 0 || typeof c.id !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/.test(c.id)) throw new Error();
        return c;
    } catch { throw new TradingError('INVALID_REQUEST', 'Invalid history cursor'); }
}
export function encodeCursor(time: number, id: string) { return Buffer.from(JSON.stringify({ time, id })).toString('base64url'); }
