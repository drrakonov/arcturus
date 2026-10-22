// Fault injection is confined to the caller's disposable database/Redis namespace.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Engine } from '../engine/dist/trade/engine.js';
import { replayFailed, QUEUE, PROCESSING, FAILED } from '../db-processor/dist/queue.js';

export async function verifyHistory({ pool, redis, request, session, launch, children, until }) {
  const seller = await session(), buyer = await session(), stranger = await session();
  const events = [];
  let now = Math.floor(Date.now()/60000)*60000-120000+1000;
  const engine = new Engine({ now:()=>now, sink: { pushMessage:e=>events.push(e), publishMessage(){},sendToApi(){} } });
  for(const userId of [seller.userId,buyer.userId])engine.process({message:{type:'CREATE_ACCOUNT',data:{userId}},clientId:'fixture'});
  const first=engine.createOrder('SOL_INR','9','1','sell',seller.userId);
  const second=engine.createOrder('SOL_INR','10','2','sell',seller.userId);
  now+=1000;
  engine.createOrder('SOL_INR','11','2','buy',buyer.userId);
  const fill=events.at(-1);
  now+=1000;engine.cancelOrder('SOL_INR',second.orderId,seller.userId);
  const cancellation=events.at(-1), historyId=fill.historyId;

  // Fail after order writes, proving the entire batch (including dedup) rolls back.
  await pool.query(`CREATE FUNCTION test_reject_trade() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'intentional integration failure'; END $$;
    CREATE TRIGGER test_reject_trade BEFORE INSERT ON trades FOR EACH ROW EXECUTE FUNCTION test_reject_trade()`);
  await redis.lPush(QUEUE,JSON.stringify(fill));
  await until(async()=>await redis.lLen(FAILED)===1,'bounded failed-event retention');
  const failed=JSON.parse(await redis.lIndex(FAILED,0));
  assert.equal(failed.attempts,3);assert.equal(JSON.parse(failed.raw).eventId,fill.eventId);
  assert.equal((await pool.query('SELECT count(*) FROM orders WHERE history_id=$1',[historyId])).rows[0].count,'0');
  assert.equal((await pool.query('SELECT count(*) FROM processed_events WHERE event_id=$1',[fill.eventId])).rows[0].count,'0');
  await pool.query('DROP TRIGGER test_reject_trade ON trades; DROP FUNCTION test_reject_trade()');
  assert.equal(await replayFailed(redis,10),1);
  await until(async()=>(await pool.query('SELECT count(*) FROM trades WHERE history_id=$1',[historyId])).rows[0].count==='2','failed event replay');
  // Deliver cancellation before old placement, then repeat every event.
  for(const event of [cancellation,...events,...events])await redis.lPush(QUEUE,JSON.stringify(event));
  await until(async()=>await redis.lLen(QUEUE)===0 && await redis.lLen(PROCESSING)===0,'replay queue drain');
  const persisted=(await pool.query('SELECT order_id,status,executed_qty FROM orders WHERE history_id=$1',[historyId])).rows;
  assert.equal(persisted.length,3);
  assert.equal(persisted.find(o=>o.order_id===second.orderId).status,'cancelled');
  assert.equal(Number(persisted.find(o=>o.order_id===second.orderId).executed_qty),1);
  assert.equal((await pool.query('SELECT count(*) FROM trades WHERE history_id=$1',[historyId])).rows[0].count,'2');
  const history=(await request('/api/v1/order/history?market=SOL_INR&limit=1',undefined,200,'GET',seller.token)).payload;
  assert.equal(history.rows[0].orderId,second.orderId);assert.ok(history.nextCursor);
  const next=(await request(`/api/v1/order/history?market=SOL_INR&limit=1&cursor=${history.nextCursor}`,undefined,200,'GET',seller.token)).payload;
  assert.equal(next.rows[0].orderId,first.orderId);assert.equal(next.nextCursor,null);
  assert.equal((await request(`/api/v1/order/history?market=SOL_INR&userId=${seller.userId}`,undefined,200,'GET',stranger.token)).payload.rows.length,0);
  assert.equal((await request('/api/v1/account/trades?market=SOL_INR',undefined,200,'GET',buyer.token)).payload.rows.length,2);
  assert.equal((await request(`/api/v1/account/trades?market=SOL_INR&userId=${buyer.userId}`,undefined,200,'GET',stranger.token)).payload.rows.length,0);
  await request('/api/v1/order/history?market=SOL_INR',undefined,401);
  for(const path of ['/api/v1/order/history?market=SOL_INR&limit=-1','/api/v1/account/trades?market=SOL_INR&cursor=bad'])await request(path,undefined,400,'GET',seller.token);
  const candles=(await request(`/api/v1/klines?symbol=SOL_INR&historyId=${historyId}&interval=1m`)).payload;
  assert.equal(candles.length,1);
  assert.deepEqual(['open','high','low','close','volume'].map(k=>Number(candles[0][k])),[9,10,9,10,2]);
  assert.equal((await request(`/api/v1/klines?symbol=SOL_INR&historyId=${stranger.userId}&interval=1m`)).payload.length,0);
  await request(`/api/v1/klines?symbol=SOL_INR&historyId=${historyId}&limit=NaN`,undefined,400);
  await request(`/api/v1/klines?symbol=SOL_INR&historyId=${historyId}&interval=1h`,undefined,400);
  await request(`/api/v1/klines?symbol=SOL_INR&historyId=${historyId}&startTime=0`,undefined,400);

  // Retention removes terminal history, but never a still-open order.
  await pool.query(`INSERT INTO orders(order_id,user_id,status,updated_at) VALUES
    ('retention-closed','retention-owner','cancelled',NOW()-INTERVAL '40 days'),
    ('retention-open','retention-owner','open',NOW()-INTERVAL '40 days');
    INSERT INTO processed_events VALUES ('retention-event',NOW()-INTERVAL '40 days');
    INSERT INTO trades(id,market,price,quantity,quote_qty,is_buyer_maker,timestamp)
    VALUES ('retention-trade','RETENTION_INR',1,1,1,false,NOW()-INTERVAL '40 days');`);
  await pool.query("CALL refresh_continuous_aggregate('klines_1m',NOW()-INTERVAL '41 days',NOW()-INTERVAL '39 days')");
  // Hold SQL writes, kill the real worker after its Redis claim, then recover it.
  now+=1000;const pending=engine.createOrder('SOL_INR','1','1','buy',buyer.userId);
  const crashEvent=events.at(-1);
  const lock=await pool.connect();
  await lock.query('BEGIN');await lock.query('LOCK TABLE orders IN ACCESS EXCLUSIVE MODE');
  let worker=children.find(c=>c.spawnargs.some(a=>a.endsWith('/db-processor/dist/index.js')) && c.exitCode===null);
  try {
    await redis.lPush(QUEUE,JSON.stringify(crashEvent));
    await until(async()=>await redis.lIndex(PROCESSING,-1)===JSON.stringify(crashEvent),'claim before worker kill');
    const exited=once(worker,'exit');worker.kill('SIGKILL');await exited;
    children.splice(children.indexOf(worker),1);
  } finally {await lock.query('ROLLBACK');lock.release();}
  worker=launch('db-processor');
  await until(async()=>(await pool.query('SELECT count(*) FROM orders WHERE order_id=$1',[pending.orderId])).rows[0].count==='1','recovered in-flight claim');
  await until(async()=>await redis.lLen(PROCESSING)===0,'recovery acknowledged');
  // Verify LIMIT selects the latest bars, while the response stays chronological.
  const countBefore=events.length;
  now+=65000;engine.createOrder('SOL_INR','11','1','sell',seller.userId);
  engine.createOrder('SOL_INR','11','1','buy',buyer.userId);
  for(const event of events.slice(countBefore))await redis.lPush(QUEUE,JSON.stringify(event));
  await until(async()=>(await pool.query('SELECT count(*) FROM trades WHERE history_id=$1',[historyId])).rows[0].count==='3','later candle persistence');
  const latest=(await request(`/api/v1/klines?symbol=SOL_INR&historyId=${historyId}&interval=1m&limit=1`)).payload;
  assert.equal(latest.length,1);assert.equal(Number(latest[0].close),11);
  assert.ok(latest[0].time>candles[0].time);
  const tradePage=(await request('/api/v1/account/trades?market=SOL_INR&limit=1',undefined,200,'GET',buyer.token)).payload;
  assert.ok(tradePage.nextCursor);
  const older=(await request(`/api/v1/account/trades?market=SOL_INR&limit=1&cursor=${tradePage.nextCursor}`,undefined,200,'GET',buyer.token)).payload;
  assert.notEqual(older.rows[0].id,tradePage.rows[0].id);
  await redis.lPush(QUEUE,'not-json');
  await until(async()=>await redis.lLen(FAILED)===1,'malformed event retained');
  assert.equal(JSON.parse(await redis.lIndex(FAILED,0)).raw,'not-json');
  await redis.del(FAILED); // Test-owned malformed record has been inspected.
  // Late events outside retention cannot recreate pruned orders or trades.
  const expired=structuredClone(crashEvent);expired.eventId+='-expired';expired.timestamp=Date.now()-31*86400000;
  expired.orders[0].orderId+='-expired';expired.orders[0].createdAt=expired.timestamp;expired.orders[0].updatedAt=expired.timestamp;
  await redis.lPush(QUEUE,JSON.stringify(expired));
  await until(async()=>await redis.lLen(QUEUE)===0 && await redis.lLen(PROCESSING)===0,'expired event acknowledged');
  assert.equal((await pool.query('SELECT count(*) FROM orders WHERE order_id=$1',[expired.orders[0].orderId])).rows[0].count,'0');
  assert.equal((await pool.query("SELECT count(*) FROM orders WHERE order_id='retention-closed'")).rows[0].count,'0');
  assert.equal((await pool.query("SELECT count(*) FROM orders WHERE order_id='retention-open'")).rows[0].count,'1');
  assert.equal((await pool.query("SELECT count(*) FROM processed_events WHERE event_id='retention-event'")).rows[0].count,'0');
  const policies=(await pool.query("SELECT job_id,config FROM timescaledb_information.jobs WHERE proc_name='policy_retention'")).rows;
  assert.equal(policies.length,2);
  for(const policy of policies){assert.equal(policy.config.drop_after,'7 days');await pool.query('CALL run_job($1)',[policy.job_id]);}
  assert.equal((await pool.query("SELECT count(*) FROM trades WHERE id='retention-trade'")).rows[0].count,'0');
  assert.equal((await pool.query("SELECT count(*) FROM klines_1m WHERE market='RETENTION_INR'")).rows[0].count,'0');
  console.log('PASS: transactional rollback, three retries/dead-letter replay, duplicate and out-of-order events, private paginated histories, exact stored candles, crash-after-claim recovery, repeat migrations and expired-event protection.');
}
