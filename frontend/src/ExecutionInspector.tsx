import { useEffect, useState } from 'react';
import type { ExecutionDetails } from '../../packages/contracts/src/index';
import { request } from './client';
const amount = (value: string | number) => Number(value).toLocaleString('en-IN', {maximumFractionDigits:6});

export function ExecutionInspector({orderId,token,onClose}:{orderId:string;token?:string;onClose:()=>void}) {
  const [data,setData]=useState<ExecutionDetails|null>(null), [error,setError]=useState(''), [cursor,setCursor]=useState<string|null>(null), [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    let stopped=false;
    setError(''); setData(null);
    request<ExecutionDetails>(`/api/v1/order/${orderId}/executions${cursor ? `?cursor=${cursor}`:''}`,token)
      .then(value=>{if(!stopped)setData(value);}).catch(e=>{if(!stopped)setError(e.message);});
    return ()=>{stopped=true;};
  },[orderId,token,cursor,refresh]);
  return <section className="panel engineering" aria-label="Execution inspector"><div className="panel-heading"><h2>Execution inspector</h2><button onClick={onClose}>Close inspector</button></div>
    <p className="mono">Order {orderId}</p>
    {error ? <p role="alert">{error}. Persistence is asynchronous. <button onClick={()=>setRefresh(v=>v+1)}>Retry inspector</button></p> : !data ? <p role="status">Loading saved executions…</p> : <>
      <div className="execution-metrics"><span>{data.order.market} · {data.order.side} · {data.order.orderType}<strong>{data.order.status.replace('_',' ')}</strong></span><span>Executed / requested<strong>{data.order.executedQty} / {data.order.quantity}</strong></span><span>Unfilled {data.order.status==='cancelled' ? '(cancelled)':''}<strong>{amount(Number(data.order.quantity)-Number(data.order.executedQty))}</strong></span><span>Average fill price<strong>{data.summary.averagePrice ? amount(data.summary.averagePrice) : '—'}</strong></span><span>Executed value (INR)<strong>{amount(data.summary.quoteQuantity)}</strong></span><span>Price improvement (INR)<strong>{amount(data.summary.priceImprovement)}</strong></span></div>
      <div className="table-scroll" data-native-scroll><table aria-label="Execution fills"><thead><tr><th>Price</th><th>Quantity</th><th>Your role</th><th>Maker order</th><th>Taker order</th></tr></thead><tbody>{data.fills.map(fill=><tr key={fill.id}><td>{fill.price}</td><td>{fill.quantity}</td><td>{fill.role}</td><td className="mono">{fill.makerOrderId}</td><td className="mono">{fill.takerOrderId}</td></tr>)}</tbody></table></div>
      {!data.fills.length && <p>No persisted fills for this order.</p>}
      <div className="history-controls"><button disabled={!cursor} onClick={()=>setCursor(null)}>First fills</button><span>{data.summary.fillCount} fills total</span><button disabled={!data.nextCursor} onClick={()=>setCursor(data.nextCursor)}>Older fills</button></div>
    </>}
  </section>;
}
