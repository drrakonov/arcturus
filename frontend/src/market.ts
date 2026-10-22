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
