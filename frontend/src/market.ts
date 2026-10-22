import type { Candle, MarketSnapshot } from '../../packages/contracts/src/index';

export function mergeMarket(current: MarketSnapshot | null, next: MarketSnapshot): MarketSnapshot {
  if (!current || current.generation !== next.generation) return next;
  const newest = next.revision >= current.revision ? next : current;
  const older = newest === next ? current : next;
  const merge = (a: Candle[], b: Candle[]) => [...new Map([...a, ...b].map(c => [c.time, c])).values()]
    .sort((a, b) => a.time - b.time).slice(-180);
  // REST carries history; WS carries only the current candle. An older REST response
  // can backfill history without rolling back newer live prices or candle volume.
  return { ...newest, candles: {
    '5s': merge(older.candles?.['5s'] ?? [], newest.candles?.['5s'] ?? []),
    '1m': merge(older.candles?.['1m'] ?? [], newest.candles?.['1m'] ?? []),
  } };
}

// Persisted history fills older gaps; engine bars win overlaps because SQL can lag.
export function mergeCandles(history: Candle[], live: Candle[], limit = 1000): Candle[] {
  return [...new Map([...history, ...live].map(c => [c.time, c])).values()]
    .sort((a,b) => a.time-b.time).slice(-limit);
}

export function backfillCandles(cached: Candle[], stored: Candle[]): Candle[] {
  const lots = (value: string) => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0')); };
  const rows = new Map(cached.map(c => [c.time,c]));
  for (const candle of stored) {
    const old = rows.get(candle.time);
    // Volume only grows within a history/bucket. Late SQL must not replace a more complete observed bar.
    if (!old || lots(candle.volume) >= lots(old.volume)) rows.set(candle.time,candle);
  }
  return [...rows.values()].sort((a,b)=>a.time-b.time).slice(-1000);
}
