import { formatDecimal, parseDecimal } from '@arcturus/contracts';
import type { Candle, CandleInterval } from '@arcturus/contracts';

export const CANDLE_LIMIT = 180;
export const INTERVAL_SECONDS: Record<CandleInterval, number> = { '5s': 5, '1m': 60 };

// Aggregate actual fills only. Empty intervals stay empty; volume uses exact lot units.
export function addFill(rows: Candle[], price: bigint, quantity: bigint, timestamp: number, interval: CandleInterval) {
    const seconds = INTERVAL_SECONDS[interval];
    const time = Math.floor(timestamp / 1000 / seconds) * seconds;
    let candle = rows.find(row => row.time === time);
    const value = formatDecimal(price, 2);
    if (!candle) {
        candle = { time, open: value, high: value, low: value, close: value, volume: formatDecimal(quantity, 4) };
        rows.push(candle);
        rows.sort((a, b) => a.time - b.time);
    } else {
        if (price > parseDecimal(candle.high, 2)) candle.high = value;
        if (price < parseDecimal(candle.low, 2)) candle.low = value;
        candle.close = value;
        candle.volume = formatDecimal(parseDecimal(candle.volume, 4, 10n ** 30n) + quantity, 4);
    }
    if (rows.length > CANDLE_LIMIT) rows.splice(0, rows.length - CANDLE_LIMIT);
}
