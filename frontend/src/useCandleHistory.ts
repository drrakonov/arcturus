import { useEffect, useMemo, useState } from "react";
import type { Candle, CandleInterval, MarketSnapshot } from "../../packages/contracts/src/index";
import { request } from "./client";
import { mergeCandles, backfillCandles } from "./market";

export function useCandleHistory(
    market: MarketSnapshot | null,
    interval: CandleInterval,
    connected: boolean
) {
    const key = `${market?.historyId}:${market?.generation}:${interval}`;
    const [saved, setSaved] = useState<{ key: string; rows: Candle[] }>({ key: "", rows: [] });
    const [retry, setRetry] = useState(0),
        [error, setError] = useState(""),
        [loading, setLoading] = useState(false);
    useEffect(() => {
        if (!market?.historyId || !connected) return;
        let stopped = false;
        setLoading(true);
        setError("");
        void request<Candle[]>(
            `/api/v1/klines?symbol=${market.market}&historyId=${market.historyId}&interval=${interval}&limit=500`
        )
            .then(rows => {
                if (!stopped)
                    setSaved(old => ({
                        key,
                        rows: backfillCandles(old.key === key ? old.rows : [], rows)
                    }));
            })
            .catch(() => {
                if (!stopped) setError("Historical candles unavailable; showing live executions.");
            })
            .finally(() => {
                if (!stopped) setLoading(false);
            });
        return () => {
            stopped = true;
        };
    }, [key, retry, connected]);
    useEffect(() => {
        if (!market) return;
        setSaved(old => ({
            key,
            rows: mergeCandles(old.key === key ? old.rows : [], market.candles[interval])
        }));
    }, [key, market, interval]);
    const rows = useMemo(
        () => mergeCandles(saved.key === key ? saved.rows : [], market?.candles?.[interval] ?? []),
        [saved, key, market?.candles, interval]
    );
    return { rows, error, loading, retry: () => setRetry(n => n + 1) };
}
