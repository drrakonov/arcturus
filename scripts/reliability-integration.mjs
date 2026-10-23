import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { resetDemo } from './reset-demo.mjs';

export async function verifyReliability({redis,redisUrl,dir,pool,request,buyer,launch,children,until}) {
  const snapshotPath=join(dir,'snapshot.json');
  const options={redisUrl,snapshotPath,confirmed:true};
  await assert.rejects(resetDemo(options),/Stop all app services/);
  const engine=launch('engine',undefined,{WITH_SNAPSHOT:'1'});
  const account=(await request('/api/v1/account',undefined,200,'GET',buyer.token)).payload;
  assert.equal(account.balances.INR.available,'99999.999999');
  assert.equal(account.balances.SOL.available,'100.0001');
  await until(async()=>await redis.lLen('message')===0 && await redis.lLen('db_processor')===0 && await redis.lLen('db_processor:processing')===0,'drain restored engine and worker');
  const saved=JSON.parse(await readFile(snapshotPath,'utf8'));
  const historyCount=(await pool.query('SELECT count(*) FROM trades')).rows[0].count;
  // Graceful shutdown must leave a valid snapshot and remove process-presence keys.
  for(const child of [...children]) {
    if(child.exitCode===null){
      const exited=once(child,'exit');child.kill('SIGTERM');await exited;
      const vite=child.spawnargs.some(arg=>arg.endsWith('/vite/bin/vite.js'));
      if(vite)assert.ok([0,143].includes(child.exitCode),'Vite exits normally or with its SIGTERM status');
      else assert.equal(child.exitCode,0,`Graceful service exit: ${child.spawnargs.join(' ')}`);
    }
    children.splice(children.indexOf(child),1);
  }
  await until(async()=>(await redis.keys('runtime:service:*')).length===0,'expired old process heartbeats');
  await redis.lPush('message','pending-fixture');
  await assert.rejects(resetDemo(options),/not empty/);await redis.del('message');
  const result=await resetDemo(options);assert.ok(result.backup);await access(result.backup);
  assert.equal(JSON.parse(await readFile(result.backup,'utf8')).historyId,saved.historyId);
  const fresh=JSON.parse(await readFile(snapshotPath,'utf8'));
  assert.notEqual(fresh.historyId,saved.historyId);assert.equal(fresh.orderbooks[0].bids.length,0);assert.equal(fresh.orderbooks[0].asks.length,0);
  assert.equal((await redis.keys('demo:session:*')).length,0);assert.equal((await redis.keys('trace:*')).length,0);
  assert.equal((await pool.query('SELECT count(*) FROM trades')).rows[0].count,historyCount);
  // A service cannot start while the reset guard is held.
  await redis.set('runtime:reset','test',{EX:10});
  const refused=launch('engine',undefined,{WITH_SNAPSHOT:'1'});await once(refused,'exit');
  assert.equal(refused.exitCode,1);assert.deepEqual(JSON.parse(await readFile(snapshotPath,'utf8')),fresh);children.splice(children.indexOf(refused),1);await redis.del('runtime:reset');
  const resetEngine=launch('engine',undefined,{WITH_SNAPSHOT:'1'});
  await until(async()=>(await redis.keys('runtime:service:engine:*')).length>0,'fresh engine startup');
  const stopped=once(resetEngine,'exit');resetEngine.kill('SIGTERM');await stopped;assert.equal(resetEngine.exitCode,0);
  children.splice(children.indexOf(resetEngine),1);
  console.log('PASS: guarded reset, snapshot restore, graceful service shutdown, reset backup, session invalidation and retained SQL history.');
}
