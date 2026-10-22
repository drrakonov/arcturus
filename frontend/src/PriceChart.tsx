import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, ColorType, CrosshairMode } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { Expand, Radio } from 'lucide-react';
import type { Candle, CandleInterval, MarketSnapshot } from '../../packages/contracts/src/index';

export function PriceChart({ market }: { market: MarketSnapshot | null }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const priceSeries = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeries = useRef<ISeriesApi<'Histogram'> | null>(null);
  const viewKey = useRef('');
  const [interval, setInterval] = useState<CandleInterval>('5s');
  const [hover, setHover] = useState<{ open: number; high: number; low: number; close: number } | null>(null);
  const rows = market?.candles?.[interval] ?? [];
  const latest = rows.at(-1);
  const values = hover ?? (latest ? Object.fromEntries(['open', 'high', 'low', 'close'].map(k => [k, Number(latest[k as keyof Candle])])) : null);

  useEffect(() => {
    if (!host.current) return;
    const instance = createChart(host.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#14161b' }, textColor: '#969ca9', fontFamily: 'ui-monospace, monospace', fontSize: 10, attributionLogo: true },
      grid: { vertLines: { color: '#1b1e26' }, horzLines: { color: '#222630' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#808a9f', labelBackgroundColor: '#333946' }, horzLine: { color: '#808a9f', labelBackgroundColor: '#333946' } },
      rightPriceScale: { borderColor: '#242830', scaleMargins: { top: .12, bottom: .25 } },
      timeScale: { borderColor: '#242830', timeVisible: true, secondsVisible: true, rightOffset: 6, barSpacing: 9 },
    });
    const price = instance.addSeries(CandlestickSeries, { upColor: '#00c896', downColor: '#f56775', borderVisible: false, wickUpColor: '#00c896', wickDownColor: '#f56775', priceLineColor: '#808a9f' });
    const volume = instance.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume', priceLineVisible: false, lastValueVisible: false });
    instance.priceScale('volume').applyOptions({ scaleMargins: { top: .83, bottom: 0 }, visible: false });
    instance.subscribeCrosshairMove(event => {
      const candle = event.seriesData.get(price);
      setHover(candle && 'open' in candle ? candle : null);
    });
    chart.current = instance; priceSeries.current = price; volumeSeries.current = volume;
    return () => { instance.remove(); chart.current = null; };
  }, []);
  useEffect(() => {
    priceSeries.current?.setData(rows.map(c => ({ time: c.time as UTCTimestamp, open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) })));
    volumeSeries.current?.setData(rows.map(c => ({ time: c.time as UTCTimestamp, value: Number(c.volume), color: Number(c.close) >= Number(c.open) ? '#00c89635' : '#f5677535' })));
    const key = `${market?.generation}:${interval}`;
    if (rows.length && viewKey.current !== key) {
      chart.current?.timeScale().setVisibleLogicalRange({ from: Math.max(-3, rows.length - 65), to: Math.max(25, rows.length + 5) });
      viewKey.current = key;
    }
  }, [rows, interval, market?.generation]);
  return <div className="price-chart">
    <div className="chart-toolbar"><div className="chart-title"><img src="/solana.svg" alt="" width="18" height="15"/><strong>SOL / INR</strong><span>Price & volume</span></div>
      <div className="chart-tools">{(['5s', '1m'] as const).map(value => <button key={value} aria-pressed={interval === value} className={interval === value ? 'active' : ''} onClick={() => { setInterval(value); setHover(null); }}>{value}</button>)}<button title="Fit chart to executions" aria-label="Fit chart" onClick={() => chart.current?.timeScale().fitContent()}><Expand size={14}/></button></div></div>
    <div className="ohlc">{(['open', 'high', 'low', 'close'] as const).map(key => <span key={key}>{key[0].toUpperCase()} <b className={values && values.close >= values.open ? 'buy-text' : 'sell-text'}>{values ? values[key].toFixed(2) : '—'}</b></span>)}<span className="chart-count" data-testid="candle-count">{rows.length} candles</span></div>
    <div className="chart-canvas" data-native-scroll ref={host} aria-label={`${interval} candlestick chart with execution volume`}/>
    {!rows.length && <div className="chart-wait"><Radio size={24}/><strong>Listening for executions</strong><span>Candles form when orders match. No synthetic history.</span></div>}
    <div className="chart-caption"><span><i className="live-dot"/> Engine executions · {interval} candles · UTC</span><a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">Charts by TradingView ↗</a></div>
  </div>;
}
