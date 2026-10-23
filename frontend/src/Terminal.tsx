import { EngineeringLab, ExecutionInspector } from './EngineeringLab';
import { useState, useEffect } from 'react';
import { ArrowUpRight, Activity } from 'lucide-react';
import { Tabs } from './components/Tabs';
import { History } from './History';
import { PriceChart } from './PriceChart';
import type { FormEvent } from 'react';
import { useTerminal } from './useTerminal';
import { useSmoothScroll } from './useSmoothScroll';

const fmt = (v: string | number | undefined, places = 2) => v === undefined ? '—' :
  Number(v).toLocaleString('en-IN', { minimumFractionDigits: places, maximumFractionDigits: places });
export default function Terminal() {
  useSmoothScroll();
  const t = useTerminal();
  const [selection, setSelection] = useState('');
  const [chartTab, setChartTab] = useState<'price' | 'depth'>('price');
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const [inspected, setInspected] = useState<string | null>(null);
  const [orderType, setOrderType] = useState('limit');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState('1000');
  const [quantity, setQuantity] = useState('1');
  const [tab, setTab] = useState<'orders' | 'balances' | 'history'>('orders');
  const bids = t.market?.bids ?? [], asks = t.market?.asks ?? [], trades = t.market?.trades ?? [];
  const last = trades[0];
  const spread = bids.length && asks.length ? Number(asks[0][0]) - Number(bids[0][0]) : undefined;
  const balance = t.account?.balances;
  const available = balance?.[side === 'buy' ? 'INR' : 'SOL']?.available;
  const disabled = t.status !== 'live' || t.busy || !!t.pending;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    t.mutate('POST', { market: 'SOL_INR', ...(orderType === 'market' ? { orderType, protectionPrice: price } : { price }), quantity, side }, `${side} ${quantity} SOL at ${price}`);
  };
  const depthRows = (rows: [string, string][], direction: 'buy' | 'sell') => {
    const max = Math.max(...rows.map(([, q]) => Number(q)), 1);
    return rows.slice(0, 8).map(([p, q]) => <button className={`book-row ${direction}`} key={`${p}-${q}`} onClick={() => { setPrice(p); setSelection(`Limit price set to ₹${fmt(p)}`); }} title={`Use price ₹${p}`}>
      <span className="depth-bar" style={{ width: `${Number(q) / max * 100}%` }}/>
      <span>{fmt(p)}</span><span>{fmt(q, 4)}</span><span>{fmt(Number(p) * Number(q))}</span>
    </button>);
  };
  return <div className="shell">
    <header className="topbar"><a className="brand" href="/" aria-label="Arcturus home"><span className="brand-mark">✳</span><span>ARCTURUS<small>EXCHANGE</small></span></a>
      <nav aria-label="Main navigation"><span className="nav-active">Spot trading</span><span className="demo-badge">DEMO</span></nav>
      <div className="top-right"><span className={`connection ${t.status}`} role="status"><i/>{({ live: 'Live connection', connecting: 'Connecting', reconnecting: 'Reconnecting', failed: 'Connection failed', expired: 'Session expired' } as Record<string, string>)[t.status]}</span>
      <span className="avatar">{t.session ? t.session.userId.slice(0, 2).toUpperCase() : '··'}</span></div></header>
    <main>
      <div className="intro"><h1>Trading terminal <span>01 / SOL–INR</span></h1><a className="secondary" href="/trade" target="_blank" rel="noopener noreferrer">Open second trader <ArrowUpRight size={14}/></a></div>
      <section className="market-strip" aria-label="Market summary"><div className="pair"><span className="coin"><img src="/solana.svg" alt="Solana" width="25" height="20"/></span><div><strong>SOL <span>/ INR</span></strong><small>Solana · Demo spot market</small></div></div>
        <div className="quote"><strong className={last?.isBuyerMaker ? 'sell-text' : 'buy-text'}>{last ? `₹${fmt(last.price)}` : '—'}</strong><small>Last executed price</small></div>
        <div className="metric"><span>Best bid</span><strong>{bids[0] ? `₹${fmt(bids[0][0])}` : '—'}</strong></div><div className="metric"><span>Best ask</span><strong>{asks[0] ? `₹${fmt(asks[0][0])}` : '—'}</strong></div>
        <div className="metric"><span>Spread</span><strong>{spread === undefined ? '—' : `₹${fmt(spread)}`}</strong></div><div className="market-label"><Activity size={14}/><span>{last ? `Last fill ${Math.max(0, Math.floor((clock - last.timestamp) / 1000))}s ago` : 'Awaiting executions'}</span></div></section>
      {t.error && <div className="alert" role="alert"><span>{t.error}</span><div>{t.pending ? <><button onClick={t.retry} disabled={t.busy || t.status !== 'live'}>Retry same request</button><button onClick={t.clearPending} disabled={t.busy}>I checked my orders · clear</button></> : t.status === 'expired' ? <button onClick={t.restart}>Start new session</button> : t.status === 'failed' ? <button onClick={t.retry}>Retry connection</button> : <button onClick={t.dismissError} aria-label="Dismiss error">×</button>}</div></div>}
      {t.pending && !t.busy && !t.error && <div className="alert" role="alert">An earlier request needs confirmation: {t.pending.label}<button onClick={t.retry} disabled={t.status !== 'live'}>Retry same request</button></div>}
      {t.status === 'reconnecting' && <div className="reconnect-banner">Reconnecting to live trading. Displayed values may be stale; order entry is paused.</div>}
      <div className="trading-grid">
        <section className="panel book"><div className="panel-heading"><h2>Order book</h2><span className="subtle">Top 8 levels</span></div><div className="book-labels"><span>Price (INR)</span><span>Amount (SOL)</span><span>Total (INR)</span></div>
          <div className="book-side asks">{asks.length ? depthRows([...asks.slice(0, 8)].reverse(), 'sell') : <div className="quiet">{t.market ? 'No sell orders' : 'Loading order book…'}</div>}</div>
          <div className="book-mid"><strong>{last ? `₹${fmt(last.price)}` : 'Awaiting first trade'}</strong><span>{spread === undefined ? 'Spread —' : `Spread ₹${fmt(spread)}`}</span></div>
          <div className="book-side">{bids.length ? depthRows(bids, 'buy') : <div className="quiet">{t.market ? 'No buy orders' : 'Loading order book…'}</div>}</div>
          <div className="liquidity-ratio"><span className="buy-text">Buy liquidity</span><span className="sell-text">Sell liquidity</span><div><i style={{ width: `${bids.reduce((s, [,q]) => s + Number(q), 0) / ([...bids, ...asks].reduce((s, [,q]) => s + Number(q), 0) || 1) * 100}%` }}/></div></div>
          <div className="book-foot">Select a price to fill your order ticket <span>↗</span></div>
        </section>
        <section className="panel activity"><div className="panel-heading"><Tabs label="Chart view" tabs={[{ title: "Price chart", value: "price" }, { title: "Depth", value: "depth" }]} value={chartTab} onChange={setChartTab}/><span className="subtle">LIVE EXECUTION FEED</span></div>
          {chartTab === 'price' ? <PriceChart market={t.market} connected={t.status === 'live'}/> : <DepthChart bids={bids} asks={asks}/>}
          <div className="panel-heading trade-heading"><h2>Recent trades</h2><span className="subtle">Latest {trades.length} executions</span></div>
          <div className="trade-labels"><span>Price (INR)</span><span>Amount (SOL)</span><span>Time</span></div>
          <div className="trade-list" data-native-scroll>{trades.length ? trades.slice(0, 9).map(trade => <div className="trade-row" key={trade.id}><span className={trade.isBuyerMaker ? 'sell-text' : 'buy-text'}>{fmt(trade.price)}</span><span>{fmt(trade.quantity, 4)}</span><time>{new Date(trade.timestamp).toLocaleTimeString('en-GB')}</time></div>) : <div className="empty"><span className="empty-icon">↔</span><strong>No executions yet</strong><p>Trades appear when buy and sell orders match.<br/>Every execution here comes from the live market.</p></div>}</div>
        </section>
        <section className="panel ticket"><div className="panel-heading"><h2>Place order</h2><span className="subtle">SOL / INR</span></div><div className="side-switch" aria-label="Order side"><button className={side === 'buy' ? 'selected buy' : ''} aria-pressed={side === 'buy'} onClick={() => setSide('buy')}>Buy</button><button className={side === 'sell' ? 'selected sell' : ''} aria-pressed={side === 'sell'} onClick={() => setSide('sell')}>Sell</button></div>
          <div className="order-type"><label>Order type <select aria-label="Order type" value={orderType} onChange={e=>setOrderType(e.target.value)} disabled={t.busy}><option value="limit">Limit</option><option value="market">Protected market</option></select></label></div><form onSubmit={submit} aria-busy={t.busy}>
            <label htmlFor="price">{orderType === 'limit' ? 'Limit price' : side === 'buy' ? 'Maximum buy price' : 'Minimum sell price'}<div className="input-wrap"><input id="price" inputMode="decimal" type="number" min="0.01" max="1000000" step="0.01" required value={price} onChange={e => { setPrice(e.target.value); setSelection(''); }} disabled={t.busy}/><span>INR</span></div></label>
            <label htmlFor="quantity">Amount<div className="input-wrap"><input id="quantity" inputMode="decimal" type="number" min="0.0001" max="1000000" step="0.0001" required value={quantity} onChange={e => setQuantity(e.target.value)} disabled={t.busy}/><span>SOL</span></div></label>
            <div className="price-selection" role="status">{selection}</div><div className="available"><span>Available</span><strong>{available === undefined ? '—' : `${fmt(available, side === 'buy' ? 2 : 4)} ${side === 'buy' ? 'INR' : 'SOL'}`}</strong></div>
            <div className="order-total"><span>Order value</span><strong>₹{fmt(Number(price || 0) * Number(quantity || 0))}</strong></div>
            <button type="submit" className={`submit ${side}`} disabled={disabled}>{t.busy ? 'Confirming…' : `${side === 'buy' ? 'Buy' : 'Sell'} SOL`}</button>
            <div className={`action-feedback ${t.error ? 'has-error' : ''}`} role="status" aria-live="polite">{t.busy ? <><span className="request-spinner"/> {t.pending?.method === 'DELETE' ? 'Cancelling order…' : 'Submitting order…'} Waiting for confirmation.</> : t.error || t.notice || selection || 'Ready when you are.'}</div><p className="ticket-note">{orderType === 'limit' ? <>Executes at your limit price or better.<br/>Unfilled quantity stays in the order book.</> : <>Executes immediately within your price protection. Unfilled quantity is cancelled. Buys require the full protected value available.</>}</p>
          </form><div className="funds-note"><span>◇</span><div><strong>Practice account</strong><p>Your account starts with ₹1,00,000 and 100 SOL. No deposits. No real money.</p></div></div>
        </section>
      </div>
      <section className="panel account"><div className="account-heading"><Tabs label="Account view" tabs={[{ title: `Open orders ${t.account?.openOrders.length ?? 0}`, value: "orders" }, { title: "Balances", value: "balances" }, { title: "History", value: "history" }]} value={tab} onChange={setTab}/><span className="account-id">DEMO ACCOUNT · {t.session?.userId.slice(0, 8) || 'CONNECTING'}</span></div>
        {tab === 'history' ? <History key={t.session?.token} token={t.session?.token} revision={t.account?.revision} onInspect={setInspected}/> : tab === 'orders' ? <div className="table-scroll" data-native-scroll><table><thead><tr><th>Market</th><th>Side</th><th>Limit price</th><th>Amount</th><th>Filled</th><th>Remaining</th><th/></tr></thead><tbody>{t.account?.openOrders.map(order => <tr key={order.orderId}><td>{order.market.replace('_', ' / ')}</td><td className={`${order.side}-text`}>{order.side.toUpperCase()}</td><td>₹{fmt(order.price)}</td><td>{fmt(order.quantity, 4)}</td><td>{fmt(order.filled, 4)}</td><td>{fmt(order.quantity - order.filled, 4)}</td><td><button onClick={()=>setInspected(order.orderId)}>Inspect</button><button className="cancel" disabled={disabled} onClick={() => t.mutate('DELETE', { market: order.market, orderId: order.orderId }, `cancel ${order.orderId}`)}>{t.busy && t.pending?.label === `cancel ${order.orderId}` ? 'Cancelling…' : 'Cancel'}</button></td></tr>)}</tbody></table>{!t.account?.openOrders.length && <div className="empty compact"><strong>{t.account ? 'No open orders' : 'Loading your account…'}</strong><p>{t.account ? 'Place a limit order above. Unfilled orders will appear here.' : 'Connecting to your virtual balances and open orders.'}</p></div>}</div> : <div className="balance-grid">{Object.entries(balance ?? {}).map(([symbol, b]) => <div className="balance-card" key={symbol}><div className="asset-symbol">{symbol === 'SOL' && <img src="/solana.svg" alt="" width="22" height="18"/>}{symbol}</div><span>Available<strong data-testid={`balance-${symbol}`}>{fmt(b.available, symbol === 'INR' ? 2 : 4)}</strong></span><span>In orders<strong>{fmt(b.locked, symbol === 'INR' ? 2 : 4)}</strong></span></div>)}</div>}
      </section><div className="notice" role="status" aria-live="polite">{t.notice || 'Orders and balances are private to this demo account.'}</div>
      {inspected && <ExecutionInspector key={inspected} orderId={inspected} token={t.session?.token} onClose={()=>setInspected(null)}/>}
      <EngineeringLab token={t.session?.token} traces={t.traces} connected={t.status === 'live'} onInspect={setInspected}/>
    </main><footer><span>✦ ARCTURUS <span className="subtle">Exchange demo</span></span><span>Simulated assets only <i/> No real-money trading</span></footer>
  </div>;
}
function DepthChart({ bids, asks }: { bids: [string, string][]; asks: [string, string][] }) {
  if (!bids.length && !asks.length) return <div className="depth-empty"><div className="grid-lines"/><span>No resting liquidity</span><p>Place an order to see live market depth.</p></div>;
  const all = [...bids, ...asks].map(([p]) => Number(p));
  const min = Math.min(...all), max = Math.max(...all), span = max - min || Math.max(min * .01, .01);
  const total = Math.max(bids.reduce((s, [, q]) => s + Number(q), 0), asks.reduce((s, [, q]) => s + Number(q), 0), 1);
  const line = (rows: [string, string][]) => {
    let sum = 0;
    return rows.map(([p, q]) => { sum += Number(q); return `${25 + (Number(p) - min) / span * 510},${140 - sum / total * 110}`; });
  };
  return <div className="chart"><svg viewBox="0 0 560 170" role="img" aria-label="Cumulative order book depth"><path d="M25 30H535 M25 65H535 M25 100H535 M25 140H535" stroke="#26303f" fill="none" strokeDasharray="3 5"/>{[bids, asks].map((rows, i) => { const points = line(rows); return points.length ? <g key={i}><polygon points={`${points[0].split(',')[0]},140 ${points.join(' ')} ${points.at(-1)!.split(',')[0]},140`} fill={i ? '#ee6b7d22' : '#36d6ad22'}/><polyline points={points.join(' ')} stroke={i ? '#ee6b7d' : '#36d6ad'} strokeWidth="2" fill="none"/>{points.map((p, n) => <circle key={n} cx={p.split(',')[0]} cy={p.split(',')[1]} r="3" fill={i ? '#ee6b7d' : '#36d6ad'}/>)}</g> : null; })}<text x="25" y="162" fill="#8491a6" fontSize="11">₹{fmt(min)}</text><text x="535" y="162" textAnchor="end" fill="#8491a6" fontSize="11">₹{fmt(max)}</text></svg><div className="chart-legend"><span className="buy-text">● Buy liquidity</span><span className="sell-text">● Sell liquidity</span></div></div>;
}
