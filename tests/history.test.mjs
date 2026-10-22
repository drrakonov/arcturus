import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../engine/dist/trade/engine.js';
import { validateBatch } from '../db-processor/dist/persistence.js';
import { retentionDays } from '../db-processor/dist/db.js';
import { queryInteger, queryMarket, queryHistoryId, decodeCursor, encodeCursor } from '../api/dist/controllers/history-query.js';
import { seededRandom, planQuotes, units, setting } from '../market-maker/dist/strategy.js';

test('one engine command emits one exact lifecycle batch; restored history identity and revision persist', () => {
  const events = [], now = Date.now();
  const sink = { pushMessage: e=>events.push(e), publishMessage(){}, sendToApi(){} };
  const engine = new Engine({ sink, now: ()=>now });
  const maker = engine.createOrder('SOL_INR','9','3','sell','2');
  engine.createOrder('SOL_INR','10','1','buy','1');
  engine.cancelOrder('SOL_INR',maker.orderId,'2');
  assert.equal(events.length,3);
  for (const event of events) assert.equal(validateBatch(event),event);
  assert.equal(events[0].orders[0].status,'open');
  assert.equal(events[1].orders[0].status,'filled');
  assert.equal(events[1].orders[1].status,'partially_filled');
  assert.equal(events[2].orders[0].status,'cancelled');
  assert.equal(events[2].orders[0].executedQty,'1');
  assert.equal(events[1].trades[0].quoteQuantity,'9');
  assert.equal(events[1].trades[0].timestamp, engine.getMarket('SOL_INR').trades[0].timestamp);
  const restored = new Engine({ sink, snapshot:engine.getSnapshot(), now:()=>now+1 });
  restored.createOrder('SOL_INR','8','1','buy','1');
  assert.equal(events[3].historyId,events[0].historyId);
  assert.ok(events[3].revision>events[2].revision);
  assert.equal(new Set(events.map(e=>e.eventId)).size,4);
  assert.notEqual(new Engine().getMarket('SOL_INR').historyId,events[0].historyId);
});
test('persistence validation rejects malformed, legacy and contradictory events before writing', () => {
  const events=[];
  const engine=new Engine({sink:{pushMessage:e=>events.push(e),publishMessage(){},sendToApi(){}}});
  engine.createOrder('SOL_INR','10','1','sell','2');engine.createOrder('SOL_INR','10','1','buy','1');
  for (const mutate of [b=>b.version=2,b=>b.orders[0].executedQty='2',b=>b.orders[0].status='open',
    b=>b.trades[0].quoteQuantity='99',b=>b.trades[0].buyerId='foreign',b=>b.orders.push(b.orders[0]),b=>b.timestamp=Infinity]) {
    const batch=structuredClone(events[1]);mutate(batch);assert.throws(()=>validateBatch(batch));
  }
  assert.throws(()=>validateBatch({type:'ORDER_UPDATE',data:{orderId:'x',executedQty:1}}));
});
test('history query validation bounds work and rejects coercion and malformed cursors', () => {
  for (const v of ['NaN','1x','-1','1.5','1001',[],{}]) assert.throws(()=>queryInteger(v,50,1,1000));
  assert.equal(queryInteger(undefined,50,1,100),50);
  assert.throws(()=>queryMarket(['SOL_INR']));assert.throws(()=>queryHistoryId('bad'));
  const cursor={time:12345,id:'event:123'};assert.deepEqual(decodeCursor(encodeCursor(cursor.time,cursor.id)),cursor);
  assert.throws(()=>decodeCursor('%%%%'));assert.throws(()=>decodeCursor(Buffer.from('{"time":1}').toString('base64url')));
});
test('seeded simulator quotes repeat and never reserve more than available assets', () => {
  const run=()=>planQuotes(100000,15,15,units('25',6),units('0.01',6),seededRandom('demo'));
  assert.deepEqual(run(),run());
  const quotes=run();assert.ok(quotes.length);
  const spent=quotes.filter(o=>o.side==='buy').reduce((s,o)=>s+units(o.price,2)*units(o.quantity,4),0n);
  const sold=quotes.filter(o=>o.side==='sell').reduce((s,o)=>s+units(o.quantity,4)*100n,0n);
  assert.ok(spent<=units('25',6));assert.ok(sold<=units('0.01',6));
  assert.deepEqual(planQuotes(100000,50,50,0n,0n,seededRandom('demo')),[]);
  assert.throws(()=>setting('NaN',1,0,50));assert.throws(()=>setting('51',1,0,50));
});
test('retention configuration rejects invalid values instead of interpolating SQL', () => {
  const original=process.env.TRADE_RETENTION_DAYS;
  try {for(const value of ['0','31','7 days','NaN',"1'; DROP TABLE trades; --"]){process.env.TRADE_RETENTION_DAYS=value;assert.throws(retentionDays);}
    process.env.TRADE_RETENTION_DAYS='7';assert.equal(retentionDays(),7);
  }finally{if(original===undefined)delete process.env.TRADE_RETENTION_DAYS;else process.env.TRADE_RETENTION_DAYS=original;}
});
