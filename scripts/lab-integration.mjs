import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function verifyLab({pool,redis,request,session,until,operatorKey}) {
  const seller=await session(),buyer=await session(),stranger=await session();
  const own=async(s)=> (await request('/api/v1/account',undefined,200,'GET',s.token)).payload;
  const place=(s,body,key=randomUUID(),status=200)=>request('/api/v1/order',{market:'SOL_INR',...body},status,'POST',s.token,key);
  const sell=await place(seller,{side:'sell',price:'9',quantity:'1'});
  const key=randomUUID(),body={side:'buy',orderType:'market',protectionPrice:'10',quantity:'3',userId:seller.userId};
  const buy=await place(buyer,body,key);
  assert.equal(buy.payload.executedQty,1);assert.equal(buy.payload.cancelledQty,2);
  assert.deepEqual((await place(buyer,body,key)).payload,buy.payload);
  assert.deepEqual((await own(buyer)).balances,{INR:{available:'99991',locked:'0'},SOL:{available:'101',locked:'0'}});
  assert.equal((await own(buyer)).openOrders.length,0);
  await place(buyer,body,randomUUID(),422);
  await until(async()=> (await pool.query('SELECT status FROM orders WHERE order_id=$1',[buy.payload.orderId])).rows[0]?.status==='cancelled','protected order persistence');
  const path=`/api/v1/order/${buy.payload.orderId}/executions`;
  const detail=(await request(path,undefined,200,'GET',buyer.token)).payload;
  assert.equal(detail.order.orderType,'market');assert.equal(detail.summary.fillCount,1);
  assert.equal(Number(detail.summary.priceImprovement),1);assert.equal(Number(detail.summary.averagePrice),9);
  assert.equal(detail.fills[0].makerOrderId,sell.payload.orderId);assert.equal(detail.fills[0].role,'taker');
  assert.equal('buyerId' in detail.fills[0],false);
  await request(path,undefined,404,'GET',stranger.token);await request(path,undefined,401);
  await request(`${path}?limit=0`,undefined,400,'GET',buyer.token);
  const scenarioPath='/api/v1/demo/scenario';
  await request(scenarioPath,{scenario:'fifo'},403,'POST',buyer.token);
  await request(scenarioPath,{scenario:'fifo'},403,'POST',buyer.token,randomUUID(),'wrong');
  const account=await own(buyer),market=(await request('/api/v1/market?symbol=SOL_INR')).payload;
  for(const scenario of ['partial-fill','price-improvement','fifo']) {
    const id=randomUUID(),r=(await request(scenarioPath,{scenario},200,'POST',buyer.token,id,operatorKey)).payload;
    assert.equal(r.fills.length,scenario==='fifo'?2:1);
    if(scenario==='fifo')assert.deepEqual(r.fills.map(f=>f.quantity),['1','0.5']);
    assert.deepEqual((await request(scenarioPath,{scenario},200,'POST',buyer.token,id,operatorKey)).payload,r);
    await until(async()=> (await pool.query('SELECT count(*) FROM trades WHERE history_id=$1',[r.historyId])).rows[0].count===String(r.fills.length),'scenario persisted');
    const d=(await request(`/api/v1/order/${r.inspectedOrderId}/executions`,undefined,200,'GET',buyer.token)).payload;
    assert.equal(d.summary.fillCount,r.fills.length);
    if(scenario==='fifo') {
      const first=(await request(`/api/v1/order/${r.inspectedOrderId}/executions?limit=1`,undefined,200,'GET',buyer.token)).payload;
      assert.ok(first.nextCursor);
      const next=(await request(`/api/v1/order/${r.inspectedOrderId}/executions?limit=1&cursor=${first.nextCursor}`,undefined,200,'GET',buyer.token)).payload;
      assert.equal(next.fills.length,1);assert.notEqual(next.fills[0].id,first.fills[0].id);
    }
  }
  assert.deepEqual(await own(buyer),account);assert.deepEqual((await request('/api/v1/market?symbol=SOL_INR')).payload,market);
  const pause='/api/v1/demo/persistence-delay';
  await request(pause,{seconds:3},403,'POST',buyer.token);
  await request(pause,{seconds:16},400,'POST',buyer.token,randomUUID(),operatorKey);
  await request(pause,{seconds:3},200,'POST',buyer.token,randomUUID(),operatorKey);
  await until(async()=>!!await redis.exists('demo:worker-paused'),'worker acknowledges pause');
  const waiting=await place(seller,{side:'sell',price:'9',quantity:'1'});
  const immediate=await place(buyer,{side:'buy',orderType:'market',protectionPrice:'10',quantity:'1'});
  assert.equal(immediate.payload.executedQty,1,'matching continues while persistence is paused');
  assert.equal((await pool.query('SELECT count(*) FROM orders WHERE order_id=$1',[waiting.payload.orderId])).rows[0].count,'0');
  await until(async()=> (await pool.query('SELECT status FROM orders WHERE order_id=$1',[waiting.payload.orderId])).rows[0]?.status==='filled','automatic resume drains writes');
  await until(async()=> {
    const t=(await request('/api/v1/demo/telemetry',undefined,200,'GET',buyer.token)).payload;
    return t.events.some(e=>e.stage==='db_committed' && e.orderId===immediate.payload.orderId);
  },'actual database trace');
  const telemetry=(await request('/api/v1/demo/telemetry',undefined,200,'GET',buyer.token)).payload;
  for(const stage of ['api_received','queued','engine_committed','api_replied','db_committed','engine_replayed','engine_rejected'])assert.ok(telemetry.events.some(e=>e.stage===stage),stage);
  const privateEvents=(await request(`/api/v1/demo/telemetry?userId=${buyer.userId}`,undefined,200,'GET',stranger.token)).payload.events;
  assert.deepEqual(privateEvents,[]);
  assert.ok(telemetry.events.length<=100);
  console.log('PASS: protected orders, owned execution details, isolated real scenarios, telemetry isolation and automatic persistence resume.');
}
