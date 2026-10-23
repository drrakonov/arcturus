import { useEffect, useState } from 'react';
import type { ExecutionDetails, ScenarioKind, ScenarioResult, TraceEvent } from '../../packages/contracts/src/index';
import { ApiError, request } from './client';
const amount = (value: string | number) => Number(value).toLocaleString('en-IN', {maximumFractionDigits:6});
type ObservedTrace = TraceEvent & { forwardedAt?: number; receivedAt?: number };
type Telemetry = { events: TraceEvent[]; queued: number; processing: number; failed: number; pauseSeconds: number; paused: boolean; toolsEnabled: boolean };

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
const labels:Record<TraceEvent['stage'],string>={api_received:'API received',queued:'Redis queued',engine_committed:'Engine committed',engine_rejected:'Engine rejected',engine_replayed:'Engine replayed response',api_replied:'API replied',db_committed:'Database committed',db_failed:'Database write failed'};
export function EngineeringLab({token,traces,connected,onInspect}:{token?:string;traces:ObservedTrace[];connected:boolean;onInspect:(id:string)=>void}) {
  const [telemetry,setTelemetry]=useState<Telemetry|null>(null),[error,setError]=useState(''),[operatorKey,setOperatorKey]=useState('');
  const [scenario,setScenario]=useState<ScenarioKind>('partial-fill'),[result,setResult]=useState<ScenarioResult|null>(null),[busy,setBusy]=useState(false);
  const [pending,setPending]=useState<{key:string;scenario:ScenarioKind;createdAt:number}|null>(null),[selected,setSelected]=useState('');
  useEffect(()=>{
    if(!token)return;
    let stopped=false,loading=false;
    const load=async()=>{if(loading)return;loading=true;try{const t=await request<Telemetry>('/api/v1/demo/telemetry',token);if(!stopped){setTelemetry(t);setError('');}}catch{if(!stopped)setError('Service activity unavailable; displayed observations may be stale.');}finally{loading=false;}};
    void load();const timer=setInterval(()=>void load(),2000);return()=>{stopped=true;clearInterval(timer);};
  },[token,connected]);
  const events=[...new Map([...(telemetry?.events ?? []),...traces].map(e=>[e.id,e as ObservedTrace])).values()].sort((a,b)=>b.at-a.at).slice(0,100);
  const ids=[...new Set(events.map(e=>e.traceId))],traceId=ids.includes(selected)?selected:ids[0],current=events.filter(e=>e.traceId===traceId).sort((a,b)=>a.at-b.at);
  const [actionError,setActionError]=useState(''),[notice,setNotice]=useState('');
  const run=async()=>{
    if(busy)return;setBusy(true);setActionError('');
    const action=pending ?? {key:crypto.randomUUID(),scenario,createdAt:Date.now()};
    if(Date.now()-action.createdAt>=9*60_000){setActionError('Retry window expired. Reload the lab before starting another scenario.');setBusy(false);return;}
    setPending(action);
    try{const value=await request<ScenarioResult>('/api/v1/demo/scenario',token,{method:'POST',body:{scenario:action.scenario},key:action.key,operatorKey});setResult(value);setPending(null);setNotice('Scenario executed by the matching engine. Saved details may arrive shortly.');}
    catch(e){setActionError((e as Error).message);if(!(e as ApiError).uncertain)setPending(null);}
    finally{setBusy(false);}
  };
  const pause=async(seconds:number)=>{setBusy(true);setActionError('');try{await request('/api/v1/demo/persistence-delay',token,{method:'POST',body:{seconds},operatorKey});setNotice(seconds?'Pause requested. Waiting for the worker to acknowledge.':'Resume requested.');}catch(e){setActionError((e as Error).message);}finally{setBusy(false);}};
  const observed=(stages:TraceEvent['stage'][])=>current.some(e=>stages.includes(e.stage));
  return <section className="panel engineering" aria-label="Engineering lab"><div className="panel-heading"><h2>Inside Arcturus</h2><span className="subtle">REAL SERVICE OBSERVATIONS</span></div>
    <p>Follow an order through the services. Only observed events light up; missing observations do not imply failure.</p>
    {error && <p role="alert">{error}</p>}{!connected && <p role="status">Live connection unavailable. Waiting to reconnect.</p>}
    <label>Request trace <select aria-label="Request trace" value={traceId ?? ''} onChange={e=>setSelected(e.target.value)}><option value="" disabled>No requests observed</option>{ids.map(id=><option key={id} value={id}>{id.slice(0,12)}</option>)}</select></label>
    <div className="service-flow" aria-label="Observed service stages">{[
      ['API',observed(['api_received'])],['Redis',observed(['queued'])],['Engine',observed(['engine_committed','engine_rejected','engine_replayed'])],['PostgreSQL',observed(['db_committed'])],['WebSocket',current.some(e=>e.forwardedAt)],['Browser',current.some(e=>e.receivedAt)],
    ].map(([name,active])=><div key={String(name)} className={active?'observed':''}><i/>{name}<small>{active?'Observed':'Not observed'}</small></div>)}</div>
    <div className="trace-events" data-native-scroll>{current.map(event=><div key={event.id}><time>{new Date(event.at).toLocaleTimeString()}</time><span>{labels[event.stage]}</span>{event.orderId && <button onClick={()=>onInspect(event.orderId!)}>Inspect order</button>}</div>)}</div>
    <p className="queue-status" role="status">{telemetry ? `Persistence queue: ${telemetry.queued} waiting · ${telemetry.processing} claimed · ${telemetry.failed} failed · ${telemetry.paused ? 'Worker paused' : telemetry.pauseSeconds ? 'Pause requested' : 'Worker not paused'}${telemetry.pauseSeconds ? ` · resumes within ${telemetry.pauseSeconds}s`:''}`:'Loading queue observations…'}</p>
    <details className="demo-controls"><summary>Controlled demonstrations</summary><p>Scenarios execute real orders in an isolated DEMO / INR engine instance, then use the real persistence worker. Your SOL balances and public book are unchanged. The delay control temporarily pauses the shared persistence worker; live matching continues.</p>
      {!telemetry?.toolsEnabled ? <p>Operator controls are disabled. Configure DEMO_CONTROL_TOKEN on the API to enable them.</p> : <>
        <label>Operator key<input type="password" autoComplete="off" value={operatorKey} onChange={e=>setOperatorKey(e.target.value)}/></label>
        <label>Scenario<select aria-label="Scenario" value={scenario} disabled={!!pending || busy} onChange={e=>setScenario(e.target.value as ScenarioKind)}><option value="partial-fill">Partial fill and cancellation</option><option value="price-improvement">Price improvement</option><option value="fifo">FIFO at the same price</option></select></label>
        <div className="lab-actions"><button disabled={busy || !connected || !operatorKey} onClick={()=>void run()}>{busy?'Working…':pending?'Retry same scenario':'Run scenario'}</button><button disabled={busy || !connected || !operatorKey || !!telemetry.pauseSeconds} onClick={()=>void pause(10)}>Pause persistence for 10s</button><button disabled={busy || !connected || !operatorKey} onClick={()=>void pause(0)}>Resume persistence</button></div>
      </>}
      {actionError && <p role="alert">{actionError}</p>}<p role="status">{notice}</p>
      {result && <div className="scenario-result"><h3>Executed · {result.market}</h3><ol>{result.steps.map((step,i)=><li key={i}>{step.label} · filled {step.executedQty}{step.cancelledQty !== undefined ? ` · cancelled ${step.cancelledQty}`:''}</li>)}</ol><p>{result.fills.length} real fills · {result.fills.map(fill=>`${fill.quantity} at ₹${fill.price}`).join(', ')}</p><button onClick={()=>onInspect(result.inspectedOrderId)}>Inspect scenario execution</button></div>}
    </details>
  </section>;
}
